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

  @override
  Set<Column> get primaryKey => {clientUuid};
}

class LegMeta extends Table {
  TextColumn get legId => text()();
  TextColumn get eventId => text()();
  TextColumn get eventName => text()();
  BoolColumn get allowOverflow => boolean()();
  BoolColumn get requireRsvp => boolean()();
  BoolColumn get allowWalkins => boolean()();
  DateTimeColumn get syncedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {legId};
}

@DriftDatabase(tables: [Invitations, RevokedPasses, PendingScans, LegMeta])
class ScannerDb extends _$ScannerDb {
  ScannerDb() : super(driftDatabase(name: 'scanner'));

  /// In-memory database for tests.
  ScannerDb.forTesting(super.e);

  @override
  int get schemaVersion => 1;

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
