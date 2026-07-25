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

  /// Downloads the offline payload for a leg and caches it locally.
  /// After this returns, the gate works with no network at all.
  Future<void> openLeg(String legId) async {
    final b = await api.bootstrap(legId);

    final event = b['event'] as Map<String, dynamic>;
    keys = [
      for (final k in b['keys'] as List<dynamic>)
        EventKey(
          eventId: k['event_id'] as String,
          eventName: k['event_name'] as String,
          tokenVersion: k['token_version'] as int,
          key: base64Decode(k['key'] as String),
        ),
    ];

    await db.transaction(() async {
      await db.legMeta.insertOnConflictUpdate(LegMetaCompanion.insert(
        legId: legId,
        eventId: event['id'] as String,
        eventName: event['name'] as String,
        allowOverflow: event['allow_overflow'] as bool,
        requireRsvp: event['require_rsvp'] as bool,
        allowWalkins: event['allow_walkins'] as bool,
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

    final results = await api.submitCheckIns([
      for (final p in pending)
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

    var accepted = 0;
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
