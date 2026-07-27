import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'db.g.dart';

/// Local store. Mirrors the server's shape deliberately:
/// nothing about attendance is a mutable flag — `admitted` is always
/// admittedSynced (server truth at last sync) + SUM over the local queue.

class Invitations extends Table {
  TextColumn get passId => text()();
  TextColumn get legId => text()();
  TextColumn get displayName => text()();
  TextColumn get category => text().nullable()();
  TextColumn get tableLabel => text().nullable()();
  IntColumn get allowance => integer()();

  /// The server's admitted sum as of the last bootstrap.
  IntColumn get admittedSynced => integer()();
  TextColumn get rsvp => text()();
  TextColumn get searchTerms => text()();

  @override
  Set<Column> get primaryKey => {passId, legId};
}

class RevokedPasses extends Table {
  TextColumn get passId => text()();
  TextColumn get legId => text()();

  @override
  Set<Column> get primaryKey => {passId, legId};
}

/// The offline queue — the scanner's own append-only log. Rows are never
/// updated after being written except to mark sync state.
class PendingScans extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get legId => text()();
  TextColumn get entranceId => text().nullable()();
  TextColumn get passId => text().nullable()();
  TextColumn get result => text()();
  IntColumn get admittedCount => integer()();
  TextColumn get reversesClientUuid => text().nullable()();
  DateTimeColumn get scannedAt => dateTime()();
  TextColumn get note => text().nullable()();
  BoolColumn get synced => boolean().withDefault(const Constant(false))();
  BoolColumn get contested => boolean().withDefault(const Constant(false))();

  /// Set when this row created a household rather than admitting one that
  /// was already invited. The name has to ride along: the server cannot
  /// know it, and the queue may not drain until hours later.
  TextColumn get walkInName => text().nullable()();

  @override
  Set<Column> get primaryKey => {clientUuid};
}

/// The signing keys a leg's bootstrap handed us, on disk rather than in
/// memory alone.
///
/// Without this the keys die with the process, and an app restart with no
/// signal leaves the scanner unable to verify a single pass — every QR
/// reads as forged. Android kills backgrounded apps freely, so that is an
/// ordinary event at a gate, not an edge case.
///
/// More than one event's keys arrive per leg on purpose: that is what lets
/// a pass from the wrong wedding be *named* rather than shrugged at.
class SigningKeys extends Table {
  /// Whose bootstrap payload this key arrived in.
  TextColumn get legId => text()();
  TextColumn get eventId => text()();
  TextColumn get eventName => text()();
  IntColumn get tokenVersion => integer()();

  /// base64 — the same encoding the API sends, decoded on load.
  TextColumn get keyB64 => text()();

  @override
  Set<Column> get primaryKey => {legId, eventId, tokenVersion};
}

/// The "Which event?" list, as the server last sent it.
///
/// Persisting the signing keys was not enough on its own: offline, the
/// usher never reached the gate at all, because the list they tap through
/// was a live request with no fallback. Caching the rows verbatim keeps
/// every field the screen renders without a second shape to maintain.
class CachedAssignments extends Table {
  TextColumn get legId => text()();

  /// The assignment object exactly as the API returned it.
  TextColumn get payload => text()();
  IntColumn get position => integer()();
  DateTimeColumn get fetchedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {legId};
}

class LegMeta extends Table {
  TextColumn get legId => text()();
  TextColumn get eventId => text()();
  TextColumn get eventName => text()();
  BoolColumn get allowOverflow => boolean()();
  BoolColumn get requireRsvp => boolean()();
  BoolColumn get allowWalkins => boolean()();

  /// The organiser called the event off. Carried in the offline payload
  /// because the gate has to refuse with no network too — the settings
  /// page promises the guest that passes stop working, not that they stop
  /// working when the scanner happens to have signal.
  BoolColumn get cancelled =>
      boolean().withDefault(const Constant(false))();
  DateTimeColumn get syncedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {legId};
}

@DriftDatabase(tables: [
  Invitations,
  RevokedPasses,
  PendingScans,
  LegMeta,
  SigningKeys,
  CachedAssignments,
])
class ScannerDb extends _$ScannerDb {
  ScannerDb() : super(driftDatabase(name: 'scanner'));

  /// In-memory database for tests.
  ScannerDb.forTesting(super.e);

  @override
  int get schemaVersion => 5;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          // Phones already in the field carry an unsynced queue, so every
          // step here adds and never recreates.
          //
          // v2 persists signing keys; v3 caches the assignments list, so a
          // gate is reachable offline and not merely openable once reached.
          if (from < 2) await m.createTable(signingKeys);
          if (from < 3) await m.createTable(cachedAssignments);
          // v4 carries event cancellation to the gate.
          if (from < 4) await m.addColumn(legMeta, legMeta.cancelled);
          // v5 lets a walk-in be created with no signal.
          if (from < 5) {
            await m.addColumn(pendingScans, pendingScans.walkInName);
          }
        },
      );

  /// Local view of how many of this household are in at this leg:
  /// server truth + everything queued on this phone (reversals included —
  /// they carry negative counts, exactly like the server's log).
  Future<int> admittedLocally(String passId, String legId) async {
    final inv = await (select(invitations)
          ..where((i) => i.passId.equals(passId) & i.legId.equals(legId)))
        .getSingleOrNull();
    final base = inv?.admittedSynced ?? 0;

    final q = selectOnly(pendingScans)
      ..addColumns([pendingScans.admittedCount.sum()])
      ..where(pendingScans.passId.equals(passId) &
          pendingScans.legId.equals(legId) &
          pendingScans.result.isIn(const [
            'admitted', 'partial', 'manual', 'overflow_admitted', 'reversal',
          ]));
    final row = await q.getSingle();
    final local = row.read(pendingScans.admittedCount.sum()) ?? 0;
    return base + local;
  }
}
