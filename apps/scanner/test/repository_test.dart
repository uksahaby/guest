// The offline heart of the scanner: bootstrap cache, local decide(),
// append-only queue, reversal undo, idempotent sync. In-memory drift DB,
// fake API — no device needed.
import 'dart:convert';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scanner/api/client.dart';
import 'package:scanner/core/checkin.dart';
import 'package:scanner/core/token.dart';
import 'package:scanner/core/uuid.dart';
import 'package:scanner/store/db.dart';
import 'package:scanner/store/repository.dart';

const eventId = 'f0e1d2c3-b4a5-4968-8776-655443322110';
const legId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
final signingKey = List<int>.generate(32, (i) => i);

class FakeApi extends ApiClient {
  final List<List<Map<String, dynamic>>> submitted = [];

  /// client_uuids the "server" has already seen.
  final seen = <String>{};

  /// pass ids the server will contest (someone else admitted them).
  final contest = <String>{};

  Map<String, dynamic> bootstrapPayload;

  /// When set, bootstrap throws this instead of answering — the offline
  /// (or refused) leg-open paths.
  ApiException? bootstrapError;

  /// Same, for the assignments list.
  ApiException? assignmentsError;

  List<dynamic> assignmentRows = [
    {
      'leg_id': legId,
      'leg_name': 'Reception',
      'event_name': 'Test Wedding',
      'entrance_id': 'e1',
      'guest_count': 9,
      'is_open': true,
    },
  ];

  @override
  Future<List<dynamic>> assignments() async {
    final err = assignmentsError;
    if (err != null) throw err;
    return assignmentRows;
  }

  FakeApi(this.bootstrapPayload) : super(baseUrl: 'http://fake');

  @override
  Future<Map<String, dynamic>> bootstrap(String legId) async {
    final err = bootstrapError;
    if (err != null) throw err;
    return bootstrapPayload;
  }

  @override
  Future<List<dynamic>> submitCheckIns(
      List<Map<String, dynamic>> items) async {
    submitted.add(items);
    return [
      for (final i in items)
        {
          'client_uuid': i['client_uuid'],
          'id': randomUuid(),
          'accepted': true,
          'duplicate': !seen.add(i['client_uuid'] as String),
          'contested': contest.contains(i['pass_id']),
        },
    ];
  }

  /// Walk-ins the fake server was asked to create.
  final walkIns = <Map<String, dynamic>>[];
  ApiException? walkInError;

  @override
  Future<Map<String, dynamic>> submitWalkIn({
    required String legId,
    required String clientUuid,
    required String displayName,
    required int count,
    String? entranceId,
    String? passId,
  }) async {
    final err = walkInError;
    if (err != null) throw err;
    final row = {
      'client_uuid': clientUuid,
      'display_name': displayName,
      'count': count,
      'pass_id': passId,
    };
    walkIns.add(row);
    return {'recorded': randomUuid(), 'duplicate': false, ...row};
  }

  @override
  Future<void> testPing(String legId) async {}
}

Map<String, dynamic> bootstrapFor(List<Map<String, dynamic>> invitations,
        {List<String> revoked = const []}) =>
    {
      'synced_at': DateTime.now().toIso8601String(),
      'event': {
        'id': eventId,
        'name': 'Test Wedding',
        'allow_overflow': true,
        'require_rsvp': false,
        'allow_walkins': true,
      },
      'keys': [
        {
          'event_id': eventId,
          'event_name': 'Test Wedding',
          'token_version': 1,
          'key': base64Encode(signingKey),
        },
      ],
      'entrances': const [],
      'invitations': invitations,
      'revoked_pass_ids': revoked,
    };

Map<String, dynamic> adeyemi(String passId) => {
      'pass_id': passId,
      'display_name': 'Mr & Mrs Adeyemi',
      'category': "Groom's Family",
      'table_name': 'Table 12',
      'allowance': 4,
      'admitted': 0,
      'rsvp': 'attending',
      // The server ships only the last four digits — see usher_guest_list in
      // db/migrations/003_rls.sql. A lost device is not a leaked guest list.
      'search_terms': 'mr & mrs adeyemi 2098',
    };

String tokenFor(String passId) => issueToken(
      TokenPayload(passId: passId, eventId: eventId, tokenVersion: 1),
      signingKey,
    );

void main() {
  // One test opens a second in-memory database on its own executor; the
  // shared-executor race the warning is about cannot occur here.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  late ScannerDb db;
  late FakeApi api;
  late Repository repo;
  late String passId;

  setUp(() async {
    passId = randomUuid();
    db = ScannerDb.forTesting(NativeDatabase.memory());
    api = FakeApi(bootstrapFor([adeyemi(passId)]));
    repo = Repository(db: db, api: api, deviceId: 'test-device');
    await repo.openLeg(legId);
  });

  tearDown(() => db.close());

  test('bootstrap caches the guest list and keys for offline work', () async {
    final inv = await repo.find(passId, legId);
    expect(inv, isNotNull);
    expect(inv!.displayName, 'Mr & Mrs Adeyemi');
    expect(inv.allowance, 4);
    expect(inv.admitted, 0);
    expect(repo.keys, hasLength(1));
  });

  test('scan → count prompt (unlogged) → confirm → partial logged', () async {
    final ask = await repo.handle(legId, raw: tokenFor(passId));
    expect(ask.decision.outcome, Outcome.needsCount);
    expect(ask.clientUuid, isNull, reason: 'the prompt is not a log row');
    expect(await repo.pendingCount(), 0);

    final admit =
        await repo.handle(legId, raw: tokenFor(passId), requestedCount: 3);
    expect(admit.decision.outcome, Outcome.partial);
    expect(admit.clientUuid, isNotNull);
    expect(await repo.pendingCount(), 1);

    // Local derived state moved — with no network involved anywhere.
    final inv = await repo.find(passId, legId);
    expect(inv!.admitted, 3);

    // The fourth arrives: picker would open at 1.
    final again = await repo.handle(legId, raw: tokenFor(passId));
    expect(again.decision.outcome, Outcome.needsCount);
    expect(again.decision.choices, [1]);
  });

  test('a refusal is queued too — the organiser wants that report', () async {
    final d = await repo.handle(legId, raw: 'not-a-token');
    expect(d.decision.outcome, Outcome.invalid);
    expect(d.clientUuid, isNotNull);
    expect(await repo.pendingCount(), 1);

    final inv = await repo.find(passId, legId);
    expect(inv!.admitted, 0, reason: 'refusals admit nobody');
  });

  test('a revoked pass on the synced list is refused offline', () async {
    api.bootstrapPayload =
        bootstrapFor([adeyemi(passId)], revoked: [passId]);
    await repo.openLeg(legId);

    final d = await repo.handle(legId, raw: tokenFor(passId));
    expect(d.decision.outcome, Outcome.revoked);
  });

  test('undo writes a reversal row, never deletes', () async {
    final admit =
        await repo.handle(legId, raw: tokenFor(passId), requestedCount: 4);
    expect((await repo.find(passId, legId))!.admitted, 4);

    await repo.undo(admit.clientUuid!);
    expect(await repo.pendingCount(), 2, reason: 'reversal is a second row');
    expect((await repo.find(passId, legId))!.admitted, 0);

    // A second undo of the same scan is a no-op.
    await repo.undo(admit.clientUuid!);
    expect(await repo.pendingCount(), 2);
  });

  test('sync replays the queue in order and marks rows settled', () async {
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    await repo.handle(legId, raw: 'garbage');
    expect(await repo.pendingCount(), 2);

    final accepted = await repo.sync();
    expect(accepted, 2);
    expect(await repo.pendingCount(), 0);
    expect(api.submitted.single, hasLength(2));
    expect(api.submitted.single.first['device_id'], 'test-device');

    // Nothing left to send.
    expect(await repo.sync(), 0);
  });

  test('a replayed batch is free — duplicates are not errors', () async {
    final admit =
        await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    api.seen.add(admit.clientUuid!); // server saw it before "the network died"

    final accepted = await repo.sync();
    expect(accepted, 1);
    expect(await repo.pendingCount(), 0);
  });

  test('contested rows are flagged locally after sync', () async {
    api.contest.add(passId);
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 4);
    await repo.sync();

    final rows = await db.select(db.pendingScans).get();
    expect(rows.single.contested, isTrue);
    expect(rows.single.synced, isTrue);
  });

  test('search needs three characters and matches name or phone', () async {
    expect(await repo.search(legId, 'ad'), isEmpty);
    final byName = await repo.search(legId, 'adey');
    expect(byName.single.row.displayName, 'Mr & Mrs Adeyemi');
    // Only the last four digits are searchable; the full number never
    // reaches the device.
    final byPhone = await repo.search(legId, '2098');
    expect(byPhone, hasLength(1));
  });

  test('a wrong-event pass is named, offline', () async {
    const otherEvent = '11111111-2222-4333-8444-555566667777';
    final otherKey = List<int>.generate(32, (i) => 255 - i);
    api.bootstrapPayload['keys'] = [
      api.bootstrapPayload['keys'][0],
      {
        'event_id': otherEvent,
        'event_name': 'Yusuf & Maryam',
        'token_version': 1,
        'key': base64Encode(otherKey),
      },
    ];
    await repo.openLeg(legId);

    final foreign = issueToken(
      TokenPayload(
          passId: randomUuid(), eventId: otherEvent, tokenVersion: 1),
      otherKey,
    );
    final d = await repo.handle(legId, raw: foreign);
    expect(d.decision.outcome, Outcome.wrongEvent);
    expect(d.decision.detail, contains('Yusuf & Maryam'));
  });

  // ---- reopening a leg without the network -------------------------------
  //
  // Found by running on a real phone: the keys lived only in memory and
  // openLeg always hit the network, so an app restart at a venue with no
  // signal left the scanner unable to verify anything.

  test('a leg already downloaded reopens with no network at all', () async {
    // A fresh Repository over the same database is an app restart: the
    // in-memory keys are gone.
    final restarted = Repository(db: db, api: api, deviceId: 'test-device');
    expect(restarted.keys, isEmpty);

    api.bootstrapError = ApiException(0, 'unreachable', 'no route to host');
    await restarted.openLeg(legId);

    expect(restarted.keys, hasLength(1),
        reason: 'signing keys must survive the process');

    // And the pass still verifies, which is the only thing that matters.
    final d = await restarted.handle(legId, raw: tokenFor(passId));
    expect(d.decision.outcome, Outcome.needsCount);
    expect(d.decision.invitation!.displayName, 'Mr & Mrs Adeyemi');
  });

  test('a timeout reopens from cache just like an unreachable host', () async {
    final restarted = Repository(db: db, api: api, deviceId: 'test-device');
    api.bootstrapError =
        ApiException(408, 'timeout', "The network didn't answer.");
    await restarted.openLeg(legId);
    expect(restarted.keys, hasLength(1));
  });

  test('a leg never downloaded still fails when offline', () async {
    final fresh = ScannerDb.forTesting(NativeDatabase.memory());
    addTearDown(fresh.close);
    final cold = Repository(db: fresh, api: api, deviceId: 'test-device');
    api.bootstrapError = ApiException(0, 'unreachable', 'no route to host');

    // Nothing local to fall back to — say so rather than open an empty gate.
    await expectLater(() => cold.openLeg(legId), throwsA(isA<ApiException>()));
  });

  test('a refusal is never served from cache', () async {
    // An usher taken off the leg must stop working, even though a perfectly
    // good copy is sitting on the phone.
    final restarted = Repository(db: db, api: api, deviceId: 'test-device');
    api.bootstrapError = ApiException(403, 'forbidden', 'Not your gate.');

    await expectLater(
      () => restarted.openLeg(legId),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)),
    );
    expect(restarted.keys, isEmpty);
  });

  test('re-bootstrapping replaces the stored keys rather than piling up',
      () async {
    await repo.openLeg(legId);
    await repo.openLeg(legId);
    final rows = await db.select(db.signingKeys).get();
    expect(rows, hasLength(1));
  });

  // ---- the list that gets you to the gate --------------------------------
  //
  // Persisting keys was not enough on its own: offline, the usher never
  // reached a leg at all, because "Which event?" was a live request with no
  // fallback. Found on a device, after the first fix looked complete.

  test('the assignments list is replayed from cache when offline', () async {
    final first = await repo.assignments();
    expect(first.fromCache, isFalse);
    expect(first.rows, hasLength(1));

    api.assignmentsError = ApiException(0, 'unreachable', 'no route to host');
    final second = await repo.assignments();
    expect(second.fromCache, isTrue,
        reason: 'the screen must be able to say it is showing a copy');
    expect((second.rows.single as Map)['leg_name'], 'Reception');
    expect((second.rows.single as Map)['guest_count'], 9,
        reason: 'every field the screen renders survives the round trip');
  });

  test('an usher who has never been online sees the failure', () async {
    final fresh = ScannerDb.forTesting(NativeDatabase.memory());
    addTearDown(fresh.close);
    final cold = Repository(db: fresh, api: api, deviceId: 'test-device');
    api.assignmentsError = ApiException(408, 'timeout', 'no answer');

    await expectLater(
        () => cold.assignments(), throwsA(isA<ApiException>()));
  });

  test('a refused assignments call is not served from cache', () async {
    await repo.assignments();
    api.assignmentsError = ApiException(401, 'unauthenticated', 'Signed out.');
    await expectLater(
      () => repo.assignments(),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
    );
  });

  test('a refreshed list replaces the old one rather than merging', () async {
    await repo.assignments();
    api.assignmentRows = [
      {
        'leg_id': 'other-leg',
        'leg_name': 'Traditional',
        'event_name': 'Test Wedding',
        'entrance_id': 'e2',
        'guest_count': 4,
        'is_open': true,
      },
    ];
    await repo.assignments();

    api.assignmentsError = ApiException(0, 'unreachable', 'gone');
    final offline = await repo.assignments();
    expect(offline.rows, hasLength(1));
    expect((offline.rows.single as Map)['leg_id'], 'other-leg');
  });

  test('the whole offline journey: list, then gate, after a restart',
      () async {
    // Online once.
    await repo.assignments();

    // Restart with no signal: new Repository, empty in-memory keys.
    final restarted = Repository(db: db, api: api, deviceId: 'test-device');
    api.assignmentsError = ApiException(0, 'unreachable', 'no signal');
    api.bootstrapError = ApiException(0, 'unreachable', 'no signal');

    final list = await restarted.assignments();
    expect(list.fromCache, isTrue);

    await restarted.openLeg(list.rows.single['leg_id'] as String);
    final d = await restarted.handle(legId, raw: tokenFor(passId));
    expect(d.decision.invitation!.displayName, 'Mr & Mrs Adeyemi');
  });

  test('a cancelled event refuses at the gate, offline', () async {
    // The whole point of carrying it in the payload: the phone must refuse
    // on its own, with no network to ask.
    api.bootstrapPayload = bootstrapFor([adeyemi(passId)])
      ..['event']['cancelled'] = true;
    await repo.openLeg(legId);

    final d = await repo.handle(legId, raw: tokenFor(passId));
    expect(d.decision.outcome, Outcome.eventCancelled);
    expect(d.decision.admittedCount, 0);

    // Refusals are logged — the organiser wants to know who still turned up.
    expect(d.clientUuid, isNotNull);
    final queued = await db.select(db.pendingScans).get();
    expect(queued.single.result, 'event_cancelled');
    expect(queued.single.admittedCount, 0);
  });

  test('cancellation survives a restart with no network', () async {
    api.bootstrapPayload = bootstrapFor([adeyemi(passId)])
      ..['event']['cancelled'] = true;
    await repo.openLeg(legId);

    final restarted = Repository(db: db, api: api, deviceId: 'test-device');
    api.bootstrapError = ApiException(0, 'unreachable', 'no signal');
    await restarted.openLeg(legId);

    final d = await restarted.handle(legId, raw: tokenFor(passId));
    expect(d.decision.outcome, Outcome.eventCancelled,
        reason: 'a cached leg must not forget the event was called off');
  });

  test('reinstating the event lets the gate work again', () async {
    api.bootstrapPayload = bootstrapFor([adeyemi(passId)])
      ..['event']['cancelled'] = true;
    await repo.openLeg(legId);
    expect((await repo.handle(legId, raw: tokenFor(passId))).decision.outcome,
        Outcome.eventCancelled);

    // Nothing was reissued, so the same token works the moment the
    // organiser sets the event back to active and the phone re-bootstraps.
    api.bootstrapPayload = bootstrapFor([adeyemi(passId)]);
    await repo.openLeg(legId);
    expect((await repo.handle(legId, raw: tokenFor(passId))).decision.outcome,
        isNot(Outcome.eventCancelled));
  });

  test('a payload without the flag is treated as not cancelled', () async {
    // Older API builds omit it; the gate must not start refusing everyone.
    final payload = bootstrapFor([adeyemi(passId)]);
    (payload['event'] as Map).remove('cancelled');
    api.bootstrapPayload = payload;
    await repo.openLeg(legId);

    final d = await repo.handle(legId, raw: tokenFor(passId));
    expect(d.decision.outcome, isNot(Outcome.eventCancelled));
  });

  // ---- walk-ins, with no signal ------------------------------------------

  test('a walk-in is admitted, queued, and findable offline', () async {
    api.bootstrapError = ApiException(0, 'unreachable', 'no signal');
    final rec = await repo.addWalkIn(legId,
        displayName: 'Aunty Nkechi', count: 3, entranceId: 'e1');

    expect(rec.decision.admittedCount, 3);
    expect(rec.clientUuid, isNotNull);

    // Queued as a walk-in, so sync knows to create the household first.
    final queued = await db.select(db.pendingScans).getSingle();
    expect(queued.walkInName, 'Aunty Nkechi');
    expect(queued.admittedCount, 3);
    expect(queued.passId, isNotNull);

    // And on the local list, so search finds her without the server.
    final found = await repo.search(legId, 'nkechi');
    expect(found.single.row.displayName, 'Aunty Nkechi');
    expect(found.single.admitted, 3);
  });

  test('a walk-in can be scanned back in after stepping out', () async {
    // The reason they get a local pass rather than a bare queue row.
    final rec = await repo.addWalkIn(legId, displayName: 'Late Cousin', count: 2);
    final passId = rec.decision.invitation!.passId;

    final again = await repo.handle(legId, manualPassId: passId);
    expect(again.decision.invitation!.displayName, 'Late Cousin');
    expect(again.decision.invitation!.admitted, 2);
  });

  test('a walk-in is refused when the event forbids them', () async {
    api.bootstrapPayload = bootstrapFor([adeyemi(passId)])
      ..['event']['allow_walkins'] = false;
    await repo.openLeg(legId);

    await expectLater(
      () => repo.addWalkIn(legId, displayName: 'Nobody', count: 1),
      throwsA(isA<StateError>()),
    );
    expect(await db.select(db.pendingScans).get(), isEmpty);
  });

  test('a walk-in is refused at a cancelled event', () async {
    api.bootstrapPayload = bootstrapFor([adeyemi(passId)])
      ..['event']['cancelled'] = true;
    await repo.openLeg(legId);

    await expectLater(
      () => repo.addWalkIn(legId, displayName: 'Nobody', count: 1),
      throwsA(isA<StateError>()),
    );
  });

  test('a nameless walk-in is refused', () async {
    // The organiser has to be able to recognise who came in.
    await expectLater(
      () => repo.addWalkIn(legId, displayName: '   ', count: 1),
      throwsA(isA<ArgumentError>()),
    );
  });

  test('sync creates the household before the check-in rows', () async {
    await repo.addWalkIn(legId, displayName: 'Aunty Nkechi', count: 3);
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);

    final accepted = await repo.sync();
    expect(accepted, 2, reason: 'both the walk-in and the ordinary scan');

    expect(api.walkIns.single['display_name'], 'Aunty Nkechi');
    expect(api.walkIns.single['count'], 3);
    // The walk-in went up its own route, so the batch carried only the scan.
    expect(api.submitted.single, hasLength(1));

    final left = await (db.select(db.pendingScans)
          ..where((p) => p.synced.equals(false)))
        .get();
    expect(left, isEmpty);
  });

  test('a refused walk-in is settled, not retried forever', () async {
    // The organiser turned walk-ins off after it was queued. Retrying every
    // twelve seconds for the rest of the evening helps nobody.
    await repo.addWalkIn(legId, displayName: 'Aunty Nkechi', count: 3);
    api.walkInError = ApiException(403, 'forbidden', 'You cannot add walk-ins.');

    await repo.sync();
    final row = await db.select(db.pendingScans).getSingle();
    expect(row.synced, isTrue);
    expect(row.contested, isTrue);
    expect(row.note, contains('You cannot add walk-ins'));
  });

  test('a walk-in that cannot be sent stays queued', () async {
    await repo.addWalkIn(legId, displayName: 'Aunty Nkechi', count: 3);
    api.walkInError = ApiException(0, 'unreachable', 'no signal');

    await repo.sync();
    final row = await db.select(db.pendingScans).getSingle();
    expect(row.synced, isFalse, reason: 'no signal is not a refusal');
  });

  // ---- the recent list, and undo after the fact --------------------------
  //
  // The result overlay offers Undo for a second and a half. The case that
  // matters is the usher realising thirty seconds later, and until now
  // nothing in the system could fix that — the log is append-only and the
  // dashboard has no editor.

  test('recent shows what this phone did, newest first', () async {
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    await repo.addWalkIn(legId, displayName: 'Aunty Nkechi', count: 3);

    final rows = await repo.recent(legId);
    expect(rows, hasLength(2));
    expect(rows.first.displayName, 'Aunty Nkechi');
    expect(rows.first.isWalkIn, isTrue);
    expect(rows.last.displayName, 'Mr & Mrs Adeyemi');
    expect(rows.last.admittedCount, 2);
  });

  test('an admission can be undone from the list, once', () async {
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    final before = (await repo.recent(legId)).single;
    expect(before.canUndo, isTrue);

    await repo.undo(before.clientUuid);

    final after = (await repo.recent(legId)).single;
    expect(after.reversed, isTrue);
    expect(after.canUndo, isFalse, reason: 'twice would double the reversal');

    // The count really moved back.
    final inv = await repo.find(passId, legId);
    expect(inv!.admitted, 0);
  });

  test('the reversal is a row, not a deletion', () async {
    // The whole log is append-only; undo must not be an exception.
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    final entry = (await repo.recent(legId)).single;
    await repo.undo(entry.clientUuid);

    final queued = await db.select(db.pendingScans).get();
    expect(queued, hasLength(2));
    expect(queued.where((q) => q.result == 'reversal').single.admittedCount, -2);
  });

  test('a refusal offers no undo', () async {
    // There is nothing to take back, and the organiser wants the refusal.
    await repo.handle(legId, raw: 'not-a-token');
    final row = (await repo.recent(legId)).single;
    expect(row.admittedCount, 0);
    expect(row.canUndo, isFalse);
  });

  test('reversals are shown through the row they undo, not as their own', () async {
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    await repo.undo((await repo.recent(legId)).single.clientUuid);

    final rows = await repo.recent(legId);
    expect(rows, hasLength(1), reason: 'a reversal is not a second event');
    expect(rows.single.reversed, isTrue);
  });

  test('recent carries the sync state, so an usher knows what is queued', () async {
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    expect((await repo.recent(legId)).single.synced, isFalse);

    await repo.sync();
    expect((await repo.recent(legId)).single.synced, isTrue);
  });

  test('recent is scoped to this leg', () async {
    await repo.handle(legId, raw: tokenFor(passId), requestedCount: 2);
    expect(await repo.recent('some-other-leg'), isEmpty);
  });
}
