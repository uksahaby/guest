import 'dart:convert';

import 'package:drift/drift.dart';

import '../api/client.dart';
import '../core/checkin.dart';
import '../core/token.dart';
import '../core/uuid.dart';
import 'db.dart';

/// Wires the local store, the API and the pure decide() together.
///
/// The rules it enforces come from phase-4c §10:
///  · every check runs offline; `admitted` = server truth at last sync
///    plus this phone's own queue
///  · scans queue locally with a client_uuid and replay on reconnect —
///    a replay is free, the server returns the stored outcome
///  · an Undo writes a reversal row; nothing is ever deleted
class Repository {
  final ScannerDb db;
  final ApiClient api;
  final String deviceId;

  /// Keys for every event this usher works, loaded at bootstrap.
  List<EventKey> keys = [];

  Repository({required this.db, required this.api, String? deviceId})
      : deviceId = deviceId ?? randomUuid();

  // ---- bootstrap ----------------------------------------------------------

  /// The usher's legs, from the server when it answers and from the last
  /// answer when it does not.
  ///
  /// Persisting keys alone left the gate unreachable: this list is the only
  /// way into a leg, so offline it has to come from somewhere. `fromCache`
  /// tells the screen which it got — "downloaded an hour ago" and "live"
  /// are different promises.
  Future<({List<dynamic> rows, bool fromCache})> assignments() async {
    try {
      final rows = await api.assignments();
      await db.transaction(() async {
        await db.delete(db.cachedAssignments).go();
        for (var i = 0; i < rows.length; i++) {
          final a = rows[i] as Map<String, dynamic>;
          await db.cachedAssignments
              .insertOne(CachedAssignmentsCompanion.insert(
            legId: a['leg_id'] as String,
            payload: jsonEncode(a),
            position: i,
            fetchedAt: DateTime.now(),
          ));
        }
      });
      return (rows: rows, fromCache: false);
    } on ApiException catch (e) {
      if (!e.isTransport) rethrow;
      final cached = await (db.select(db.cachedAssignments)
            ..orderBy([(c) => OrderingTerm.asc(c.position)]))
          .get();
      if (cached.isEmpty) rethrow;
      return (
        rows: [for (final c in cached) jsonDecode(c.payload)],
        fromCache: true,
      );
    }
  }

  /// Opens a leg for scanning: refreshes the offline payload when the
  /// network allows, and otherwise reopens the copy already on disk.
  ///
  /// The fallback is the whole point of an offline scanner. An usher whose
  /// app restarts at a venue with no signal — Android kills backgrounded
  /// apps freely — must still be able to work the gate with the guest list
  /// downloaded earlier.
  ///
  /// It is deliberately narrow: only a transport failure falls back. A 403
  /// means this usher was taken off the leg, and honouring a stale local
  /// copy would let a removed usher keep admitting people.
  Future<void> openLeg(String legId) async {
    try {
      await _bootstrapLeg(legId);
    } on ApiException catch (e) {
      if (!e.isTransport) rethrow;
      if (!await _openFromCache(legId)) rethrow;
    }
  }

  /// True when a previously downloaded copy of this leg was loaded.
  Future<bool> _openFromCache(String legId) async {
    if (await meta(legId) == null) return false;
    final rows = await (db.select(db.signingKeys)
          ..where((k) => k.legId.equals(legId)))
        .get();
    // No keys means no pass can be verified, which is worse than saying so.
    if (rows.isEmpty) return false;

    keys = [
      for (final k in rows)
        EventKey(
          eventId: k.eventId,
          eventName: k.eventName,
          tokenVersion: k.tokenVersion,
          key: base64Decode(k.keyB64),
        ),
    ];
    return true;
  }

  /// Downloads the offline payload for a leg and caches it locally.
  /// After this returns, the gate works with no network at all.
  Future<void> _bootstrapLeg(String legId) async {
    final b = await api.bootstrap(legId);

    final event = b['event'] as Map<String, dynamic>;
    final fetched = [
      for (final k in b['keys'] as List<dynamic>)
        EventKey(
          eventId: k['event_id'] as String,
          eventName: k['event_name'] as String,
          tokenVersion: k['token_version'] as int,
          key: base64Decode(k['key'] as String),
        ),
    ];
    keys = fetched;

    await db.transaction(() async {
      await (db.delete(db.signingKeys)..where((k) => k.legId.equals(legId)))
          .go();
      for (final k in fetched) {
        await db.signingKeys.insertOne(SigningKeysCompanion.insert(
          legId: legId,
          eventId: k.eventId,
          eventName: k.eventName,
          tokenVersion: k.tokenVersion,
          keyB64: base64Encode(k.key),
        ));
      }

      await db.legMeta.insertOnConflictUpdate(LegMetaCompanion.insert(
        legId: legId,
        eventId: event['id'] as String,
        eventName: event['name'] as String,
        allowOverflow: event['allow_overflow'] as bool,
        requireRsvp: event['require_rsvp'] as bool,
        allowWalkins: event['allow_walkins'] as bool,
        // Older API builds omit it; absent means not cancelled.
        cancelled: Value(event['cancelled'] as bool? ?? false),
        syncedAt: DateTime.now(),
      ));

      await (db.delete(db.invitations)..where((i) => i.legId.equals(legId)))
          .go();
      for (final inv in b['invitations'] as List<dynamic>) {
        await db.invitations.insertOne(InvitationsCompanion.insert(
          passId: inv['pass_id'] as String,
          legId: legId,
          displayName: inv['display_name'] as String,
          category: Value(inv['category'] as String?),
          tableLabel: Value(inv['table_name'] as String?),
          allowance: inv['allowance'] as int,
          admittedSynced: (inv['admitted'] as num).toInt(),
          rsvp: inv['rsvp'] as String,
          searchTerms: (inv['search_terms'] as String).toLowerCase(),
        ));
      }

      await (db.delete(db.revokedPasses)..where((r) => r.legId.equals(legId)))
          .go();
      for (final id in b['revoked_pass_ids'] as List<dynamic>) {
        await db.revokedPasses.insertOne(RevokedPassesCompanion.insert(
          passId: id as String,
          legId: legId,
        ));
      }
    });
  }

  // ---- local state --------------------------------------------------------

  Future<LegMetaData?> meta(String legId) =>
      (db.select(db.legMeta)..where((m) => m.legId.equals(legId)))
          .getSingleOrNull();

  Future<LocalInvitation?> find(String passId, String legId) async {
    final row = await (db.select(db.invitations)
          ..where((i) => i.passId.equals(passId) & i.legId.equals(legId)))
        .getSingleOrNull();
    if (row == null) return null;

    final m = await meta(legId);
    final revoked = await (db.select(db.revokedPasses)
          ..where((r) => r.passId.equals(passId) & r.legId.equals(legId)))
        .getSingleOrNull();
    final admitted = await db.admittedLocally(passId, legId);

    return LocalInvitation(
      passId: row.passId,
      invitationId: '',
      eventId: m?.eventId ?? '',
      legId: legId,
      displayName: row.displayName,
      category: row.category,
      tableName: row.tableLabel,
      allowance: row.allowance,
      admitted: admitted,
      rsvp: Rsvp.values.firstWhere(
        (r) => r.name == row.rsvp,
        orElse: () => Rsvp.pending,
      ),
      revoked: revoked != null,
    );
  }

  Future<List<InvitationEntry>> search(String legId, String query) async {
    final q = query.trim().toLowerCase();
    if (q.length < 3) return const [];
    final rows = await (db.select(db.invitations)
          ..where((i) => i.legId.equals(legId) & i.searchTerms.contains(q))
          ..limit(20))
        .get();
    return [
      for (final r in rows)
        InvitationEntry(
          row: r,
          admitted: await db.admittedLocally(r.passId, legId),
        ),
    ];
  }

  // ---- the scan itself ----------------------------------------------------

  /// Runs a scan (or manual selection) through decide() against local
  /// state, and if the decision logs, queues the row. Pure logic stays in
  /// checkin.dart; this is the only place a decision becomes a row.
  Future<ScanRecord> handle(
    String legId, {
    String? raw,
    String? manualPassId,
    int? requestedCount,
    String? entranceId,
    bool? canOverrideRsvp,
  }) async {
    final m = await meta(legId);
    if (m == null) throw StateError('leg not bootstrapped');

    // ctx.find is synchronous; prefetch the one candidate household.
    LocalInvitation? candidate;
    final passIdGuess = manualPassId ?? _passIdFrom(raw!);
    if (passIdGuess != null) {
      candidate = await find(passIdGuess, legId);
    }

    final ctx = Context(
      currentEventId: m.eventId,
      currentLegId: legId,
      policy: Policy(
        allowOverflow: m.allowOverflow,
        requireRsvp: m.requireRsvp,
        eventCancelled: m.cancelled,
      ),
      keys: keys,
      find: (id) => candidate?.passId == id ? candidate : null,
      canOverrideRsvp: canOverrideRsvp ?? false,
    );

    final input = manualPassId != null
        ? ManualInput(manualPassId, requestedCount: requestedCount)
        : ScanRaw(raw!, requestedCount: requestedCount);

    final decision = decide(ctx, input);

    String? clientUuid;
    if (decision.log) {
      clientUuid = randomUuid();
      await db.pendingScans.insertOne(PendingScansCompanion.insert(
        clientUuid: clientUuid,
        legId: legId,
        entranceId: Value(entranceId),
        passId: Value(decision.invitation?.passId ??
            (decision.outcome == Outcome.wrongLeg ? null : passIdGuess)),
        result: decision.outcome.wire,
        admittedCount: decision.admittedCount,
        scannedAt: DateTime.now(),
      ));
    }

    return ScanRecord(decision: decision, clientUuid: clientUuid);
  }

  /// Someone not on the list, added at the gate with or without signal.
  ///
  /// The device mints the ids because the guest is standing there and the
  /// server may be unreachable for hours. It writes the household into the
  /// local list too, so search finds them and a second scan on the way back
  /// from the car park is an ordinary re-entry rather than a stranger.
  Future<ScanRecord> addWalkIn(
    String legId, {
    required String displayName,
    required int count,
    String? entranceId,
  }) async {
    final m = await meta(legId);
    if (m == null) throw StateError('leg not bootstrapped');
    if (!m.allowWalkins) throw StateError('this event does not admit walk-ins');
    if (m.cancelled) throw StateError('this event was cancelled');

    final name = displayName.trim();
    if (name.isEmpty) throw ArgumentError('a walk-in needs a name');

    final passId = randomUuid();
    final clientUuid = randomUuid();

    await db.transaction(() async {
      await db.invitations.insertOne(InvitationsCompanion.insert(
        passId: passId,
        legId: legId,
        displayName: name,
        allowance: count,
        // Nothing is admitted yet by the count below — the queued row is
        // what admits them, exactly as for an invited household.
        admittedSynced: 0,
        rsvp: 'attending',
        searchTerms: name.toLowerCase(),
      ));
      await db.pendingScans.insertOne(PendingScansCompanion.insert(
        clientUuid: clientUuid,
        legId: legId,
        entranceId: Value(entranceId),
        passId: Value(passId),
        result: 'manual',
        admittedCount: count,
        scannedAt: DateTime.now(),
        walkInName: Value(name),
      ));
    });

    final inv = await find(passId, legId);
    return ScanRecord(
      decision: Decision(
        outcome: Outcome.manual,
        tone: Tone.admit,
        admittedCount: count,
        headline: 'Walked in',
        detail: name,
        invitation: inv,
        remaining: 0,
        log: true,
        autoReturnMs: 1500,
        actions: const ['Undo'],
      ),
      clientUuid: clientUuid,
    );
  }

  /// What this phone has done at this gate, newest first.
  ///
  /// Undo used to live for a second and a half on the result overlay and
  /// then vanish. An usher who admits four when three came had no way back
  /// — and neither had the organiser, because the log is append-only by
  /// design. This is that way back.
  ///
  /// Only this device's own rows: the queue is what it has, and a scan
  /// from the other gate is not something it can reverse.
  Future<List<RecentEntry>> recent(String legId, {int limit = 50}) async {
    final rows = await (db.select(db.pendingScans)
          ..where((p) => p.legId.equals(legId))
          // rowid breaks the tie: two scans can land in the same
          // millisecond — a double-tap, or a walk-in added straight after
          // an admission — and a list that reorders itself between reads is
          // no use to someone trying to undo the last thing they did.
          ..orderBy([
            (p) => OrderingTerm.desc(p.scannedAt),
            (p) => OrderingTerm.desc(p.rowId),
          ])
          ..limit(limit))
        .get();

    // Which admissions already have a reversal pointing at them.
    final reversed = {
      for (final r in rows)
        if (r.reversesClientUuid != null) r.reversesClientUuid!,
    };

    final out = <RecentEntry>[];
    for (final r in rows) {
      // Reversals are shown through the row they undo, not on their own.
      if (r.reversesClientUuid != null) continue;

      String? name;
      if (r.passId != null) {
        final inv = await (db.select(db.invitations)
              ..where((i) =>
                  i.passId.equals(r.passId!) & i.legId.equals(legId)))
            .getSingleOrNull();
        name = inv?.displayName;
      }

      out.add(RecentEntry(
        clientUuid: r.clientUuid,
        displayName: name ?? r.walkInName ?? 'Not on the list',
        result: r.result,
        admittedCount: r.admittedCount,
        scannedAt: r.scannedAt,
        synced: r.synced,
        contested: r.contested,
        reversed: reversed.contains(r.clientUuid),
        isWalkIn: r.walkInName != null,
      ));
    }
    return out;
  }

  /// Undo the admission written by [clientUuid]: a reversal row, never a
  /// delete. Works offline; the server validates the pairing on sync.
  Future<void> undo(String clientUuid) async {
    final orig = await (db.select(db.pendingScans)
          ..where((p) => p.clientUuid.equals(clientUuid)))
        .getSingleOrNull();
    if (orig == null || orig.admittedCount <= 0) return;

    final already = await (db.select(db.pendingScans)
          ..where((p) => p.reversesClientUuid.equals(clientUuid)))
        .getSingleOrNull();
    if (already != null) return;

    await db.pendingScans.insertOne(PendingScansCompanion.insert(
      clientUuid: randomUuid(),
      legId: orig.legId,
      entranceId: Value(orig.entranceId),
      passId: Value(orig.passId),
      result: 'reversal',
      admittedCount: -orig.admittedCount,
      reversesClientUuid: Value(clientUuid),
      scannedAt: DateTime.now(),
    ));
  }

  // ---- sync ---------------------------------------------------------------

  Future<int> pendingCount() async {
    final q = db.selectOnly(db.pendingScans)
      ..addColumns([db.pendingScans.clientUuid.count()])
      ..where(db.pendingScans.synced.equals(false));
    final row = await q.getSingle();
    return row.read(db.pendingScans.clientUuid.count()) ?? 0;
  }

  /// Replays the queue. Batches of 500, oldest first — reversals always
  /// follow the row they undo. Returns how many rows were accepted.
  Future<int> sync() async {
    final pending = await (db.select(db.pendingScans)
          ..where((p) => p.synced.equals(false))
          ..orderBy([(p) => OrderingTerm.asc(p.scannedAt)])
          ..limit(500))
        .get();
    if (pending.isEmpty) return 0;

    // Walk-ins first, and one at a time. Each one has to create a household
    // on the server before any check-in row can reference its pass, and the
    // batch endpoint has no way to say "make this person up". A failure
    // here leaves the row queued, which is the same promise as every other
    // unsynced scan.
    var walkInsDone = 0;
    for (final p in pending.where((p) => p.walkInName != null)) {
      try {
        await api.submitWalkIn(
          legId: p.legId,
          clientUuid: p.clientUuid,
          displayName: p.walkInName!,
          count: p.admittedCount,
          entranceId: p.entranceId,
          passId: p.passId,
        );
        await (db.update(db.pendingScans)
              ..where((q) => q.clientUuid.equals(p.clientUuid)))
            .write(const PendingScansCompanion(synced: Value(true)));
        walkInsDone++;
      } on ApiException catch (e) {
        // A refusal is final — the organiser turned walk-ins off, or this
        // usher lost the permission. Settle it rather than retrying every
        // twelve seconds for the rest of the evening.
        if (!e.isTransport) {
          await (db.update(db.pendingScans)
                ..where((q) => q.clientUuid.equals(p.clientUuid)))
              .write(PendingScansCompanion(
            synced: const Value(true),
            contested: const Value(true),
            note: Value('refused: ${e.message}'),
          ));
        }
      }
    }

    final rest = pending.where((p) => p.walkInName == null).toList();
    if (rest.isEmpty) return walkInsDone;

    final results = await api.submitCheckIns([
      for (final p in rest)
        {
          'client_uuid': p.clientUuid,
          'leg_id': p.legId,
          'entrance_id': p.entranceId,
          'pass_id': p.passId,
          'result': p.result,
          'admitted_count': p.admittedCount,
          'reverses_client_uuid': p.reversesClientUuid,
          'scanned_at': p.scannedAt.toUtc().toIso8601String(),
          'device_id': deviceId,
        },
    ]);

    var accepted = walkInsDone;
    for (final r in results) {
      final map = r as Map<String, dynamic>;
      final ok = map['accepted'] == true;
      if (ok) accepted++;
      // Accepted (including duplicates) and structurally-rejected rows are
      // both settled — retrying a rejected row will never succeed.
      await (db.update(db.pendingScans)
            ..where((p) => p.clientUuid.equals(map['client_uuid'] as String)))
          .write(PendingScansCompanion(
        synced: const Value(true),
        contested: Value(map['contested'] == true),
      ));
    }
    return accepted;
  }

  String? _passIdFrom(String raw) {
    final parts = raw.trim().split('.');
    if (parts.length != 4) return null;
    try {
      return unpackUuid(parts[0]);
    } catch (_) {
      return null;
    }
  }
}

class ScanRecord {
  final Decision decision;
  final String? clientUuid;
  const ScanRecord({required this.decision, this.clientUuid});
}

class InvitationEntry {
  final Invitation row;
  final int admitted;
  const InvitationEntry({required this.row, required this.admitted});
}

/// One line in the recent list.
class RecentEntry {
  final String clientUuid;
  final String displayName;
  final String result;
  final int admittedCount;
  final DateTime scannedAt;
  final bool synced;
  final bool contested;
  final bool reversed;
  final bool isWalkIn;

  const RecentEntry({
    required this.clientUuid,
    required this.displayName,
    required this.result,
    required this.admittedCount,
    required this.scannedAt,
    required this.synced,
    required this.contested,
    required this.reversed,
    required this.isWalkIn,
  });

  /// Only an admission that moved the count can be taken back, and only
  /// once — the server enforces both, this keeps the button honest.
  bool get canUndo => admittedCount > 0 && !reversed;
}
