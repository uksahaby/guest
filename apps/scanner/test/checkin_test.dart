// Dart port of packages/checkin-core/src/checkin.test.ts — all 35 cases.
// The suites and assertions mirror the TypeScript original 1:1; if the two
// files ever disagree, both are wrong.
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:scanner/core/checkin.dart';
import 'package:scanner/core/token.dart';

// ---------------------------------------------------------------------------
// fixtures — Ahmed & Aisha, Lagos leg
// ---------------------------------------------------------------------------

final _rng = Random.secure();

List<int> randomBytes(int n) => List<int>.generate(n, (_) => _rng.nextInt(256));

String randomUuid() {
  final b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

final wedding = randomUuid();
final otherWedding = randomUuid();
final lagosLeg = randomUuid();

final weddingKey = EventKey(
  eventId: wedding,
  eventName: 'Ahmed & Aisha',
  tokenVersion: 1,
  key: randomBytes(32),
);
final otherKey = EventKey(
  eventId: otherWedding,
  eventName: 'Yusuf & Maryam',
  tokenVersion: 1,
  key: randomBytes(32),
);

LocalInvitation household({
  String? passId,
  String? displayName,
  String? tableName,
  int allowance = 4,
  int admitted = 0,
  Rsvp rsvp = Rsvp.attending,
  bool revoked = false,
}) =>
    LocalInvitation(
      passId: passId ?? randomUuid(),
      invitationId: randomUuid(),
      eventId: wedding,
      legId: lagosLeg,
      displayName: displayName ?? 'Mr & Mrs Adeyemi',
      category: "Groom's Family",
      tableName: tableName ?? 'Table 12',
      allowance: allowance,
      admitted: admitted,
      rsvp: rsvp,
      revoked: revoked,
    );

Context ctx(
  List<LocalInvitation> list, {
  Policy? policy,
  List<EventKey>? keys,
  bool canOverrideRsvp = false,
}) {
  final byId = {for (final i in list) i.passId: i};
  return Context(
    currentEventId: wedding,
    currentLegId: lagosLeg,
    policy: policy ?? const Policy(allowOverflow: true, requireRsvp: false),
    keys: keys ?? [weddingKey, otherKey],
    find: (id) => byId[id],
    canOverrideRsvp: canOverrideRsvp,
  );
}

String tokenFor(LocalInvitation inv, {EventKey? key, int version = 1}) =>
    issueToken(
      TokenPayload(
        passId: inv.passId,
        eventId: inv.eventId,
        tokenVersion: version,
      ),
      (key ?? weddingKey).key,
    );

// ---------------------------------------------------------------------------

void main() {
  group('token', () {
    test('round trips and stays short enough for a low-density QR', () {
      final inv = household();
      final t = tokenFor(inv);
      expect(t.length, lessThan(80), reason: 'token was ${t.length} chars');

      final v = verifyToken(t, [weddingKey]);
      expect(v.ok, isTrue);
      final ok = v as VerifyOk;
      expect(ok.payload.passId, inv.passId);
      expect(ok.payload.eventId, wedding);
    });

    test('rejects a tampered payload', () {
      final inv = household();
      final t = tokenFor(inv);
      final parts = t.split('.');
      // Replace the last char with one that differs from it — a quarter of
      // random uuids already end in "A", and "forging" a token into itself
      // is no forgery at all.
      final swap = parts[0].endsWith('A') ? 'B' : 'A';
      final forged = [
        parts[0].substring(0, parts[0].length - 1) + swap,
        parts[1],
        parts[2],
        parts[3],
      ].join('.');
      expect(verifyToken(forged, [weddingKey]).ok, isFalse);
    });

    test('rejects a signature from an unknown key', () {
      final stranger = randomBytes(32);
      final t = issueToken(
        TokenPayload(passId: randomUuid(), eventId: wedding, tokenVersion: 1),
        stranger,
      );
      expect(verifyToken(t, [weddingKey]).ok, isFalse);
    });

    test('identifies which held event a foreign pass belongs to', () {
      final t = issueToken(
        TokenPayload(
            passId: randomUuid(), eventId: otherWedding, tokenVersion: 1),
        otherKey.key,
      );
      final v = verifyToken(t, [weddingKey, otherKey]);
      expect(v.ok, isTrue);
      expect((v as VerifyOk).matched.eventName, 'Yusuf & Maryam');
    });

    test('a version bump kills every old pass at once', () {
      final inv = household();
      final old = tokenFor(inv, version: 1);
      final reissued = EventKey(
        eventId: weddingKey.eventId,
        eventName: weddingKey.eventName,
        tokenVersion: 2,
        key: weddingKey.key,
      );
      final v = verifyToken(old, [reissued]);
      expect(v.ok, isFalse);
      expect((v as VerifyFail).reason, 'stale_version');
    });

    test('garbage in, malformed out', () {
      for (final junk in [
        '',
        'hello',
        'a.b.c',
        'a.b.c.d.e',
        '....',
        'https://example.com',
      ]) {
        expect(verifyToken(junk, [weddingKey]).ok, isFalse);
      }
    });
  });

  // -------------------------------------------------------------------------

  group('admitting', () {
    test('a single guest goes straight through with no prompt', () {
      final inv = household(
          allowance: 1, displayName: 'Chidinma Okafor', tableName: 'Table 7');
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv)));

      expect(d.outcome, Outcome.admitted);
      expect(d.tone, Tone.admit);
      expect(d.admittedCount, 1);
      expect(d.remaining, 0);
      expect(d.autoReturnMs, 1500,
          reason: 'must return to camera on its own');
      expect(d.log, isTrue);
    });

    test('a party of four is asked how many arrived', () {
      final inv = household();
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv)));

      expect(d.outcome, Outcome.needsCount);
      expect(d.tone, Tone.ask);
      expect(d.choices, [1, 2, 3, 4]);
      expect(d.remaining, 4);
      expect(d.log, isFalse, reason: 'the prompt itself is not a log row');
      expect(d.autoReturnMs, isNull);
    });

    test('three of four is a partial admit and the pass stays live', () {
      final inv = household();
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv), requestedCount: 3));

      expect(d.outcome, Outcome.partial);
      expect(d.tone, Tone.admit);
      expect(d.admittedCount, 3);
      expect(d.remaining, 1);
      expect(d.autoReturnMs, 2500,
          reason: 'longer dwell — there is a number to read');
    });

    test('the fourth arriving later is admitted, not treated as a duplicate',
        () {
      final inv = household(admitted: 3);
      final first = decide(ctx([inv]), ScanRaw(tokenFor(inv)));

      expect(first.outcome, Outcome.needsCount);
      expect(first.choices, [1], reason: 'only one left to offer');

      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv), requestedCount: 1));
      expect(d.outcome, Outcome.admitted);
      expect(d.remaining, 0);
    });

    test('taking all four at once completes the party', () {
      final inv = household();
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv), requestedCount: 4));
      expect(d.outcome, Outcome.admitted);
      expect(d.remaining, 0);
    });
  });

  // -------------------------------------------------------------------------

  group('allowance exhausted', () {
    test('with overflow off, a fully admitted party is held', () {
      final inv = household(admitted: 4);
      final d = decide(
        ctx([inv],
            policy: const Policy(allowOverflow: false, requireRsvp: false)),
        ScanRaw(tokenFor(inv)),
      );

      expect(d.outcome, Outcome.allowanceExhausted);
      expect(d.tone, Tone.hold);
      expect(d.admittedCount, 0);
      expect(d.autoReturnMs, isNull,
          reason: 'someone is talking at the gate — do not reset');
      expect(d.detail, contains('4 of 4'));
    });

    test('with overflow on, the usher is offered the choice instead', () {
      final inv = household(admitted: 4);
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv)));

      expect(d.outcome, Outcome.needsCount);
      expect(d.remaining, 0);
      expect(d.detail, contains('over the invitation'));
    });
  });

  // -------------------------------------------------------------------------

  group('overflow', () {
    test('five through a party of four is admitted and flagged', () {
      final inv = household(displayName: 'The Nwosu Family');
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv), requestedCount: 5));

      expect(d.outcome, Outcome.overflowAdmitted);
      expect(d.tone, Tone.hold,
          reason: 'amber, not green — it is a decision, not a routine admit');
      expect(d.admittedCount, 5,
          reason: 'everyone standing there gets in');
      expect(d.detail, contains('organiser has been notified'));
    });

    test('blocked when the organiser turned overflow off', () {
      final inv = household();
      final d = decide(
        ctx([inv],
            policy: const Policy(allowOverflow: false, requireRsvp: false)),
        ScanRaw(tokenFor(inv), requestedCount: 5),
      );

      expect(d.outcome, Outcome.overflowBlocked);
      expect(d.tone, Tone.deny);
      expect(d.admittedCount, 0);
      expect(d.actions, contains('Call manager'));
    });
  });

  // -------------------------------------------------------------------------

  group('refusing', () {
    test('a revoked pass names the household', () {
      final inv = household(revoked: true, displayName: 'Tunde Bakare');
      final d = decide(ctx([inv]), ScanRaw(tokenFor(inv)));

      expect(d.outcome, Outcome.revoked);
      expect(d.tone, Tone.deny);
      expect(d.detail, contains('Tunde Bakare'));
    });

    test('a pass from another wedding says which one', () {
      final foreign = issueToken(
        TokenPayload(
            passId: randomUuid(), eventId: otherWedding, tokenVersion: 1),
        otherKey.key,
      );
      final d = decide(ctx([]), ScanRaw(foreign));

      expect(d.outcome, Outcome.wrongEvent);
      expect(d.detail, contains('Yusuf & Maryam'),
          reason: 'this is the whole point of multi-key loading');
    });

    test('a genuine pass for the other leg is distinguished from a forgery',
        () {
      final abujaOnly = household();
      // Signed for this event, but absent from the Lagos leg's list.
      final d = decide(ctx([]), ScanRaw(tokenFor(abujaOnly)));

      expect(d.outcome, Outcome.wrongLeg);
      expect(d.outcome, isNot(Outcome.invalid));
    });

    test('an unreadable code offers name search rather than dead-ending', () {
      final d = decide(ctx([]), const ScanRaw('not-a-token'));

      expect(d.outcome, Outcome.invalid);
      expect(d.actions, contains('Search by name'),
          reason: 'usually a real guest with a broken screen');
    });

    test('a reissued pass reads as revoked, not invalid', () {
      final inv = household();
      final old = tokenFor(inv, version: 1);
      final d = decide(
        ctx([inv], keys: [
          EventKey(
            eventId: weddingKey.eventId,
            eventName: weddingKey.eventName,
            tokenVersion: 2,
            key: weddingKey.key,
          ),
        ]),
        ScanRaw(old),
      );

      expect(d.outcome, Outcome.revoked);
      expect(d.detail, contains('new link'));
    });
  });

  // -------------------------------------------------------------------------

  group('the RSVP gate', () {
    final cases = <(Rsvp, bool, Outcome)>[
      (Rsvp.pending, false, Outcome.admitted),
      (Rsvp.pending, true, Outcome.rsvpBlocked),
      (Rsvp.attending, true, Outcome.needsCount),
      (Rsvp.partial, true, Outcome.needsCount),
    ];

    for (final (rsvp, requireRsvp, expected) in cases) {
      test('rsvp=${rsvp.name}, required=$requireRsvp → ${expected.wire}', () {
        final inv =
            household(rsvp: rsvp, allowance: rsvp == Rsvp.pending ? 1 : 4);
        final d = decide(
          ctx([inv],
              policy: Policy(allowOverflow: true, requireRsvp: requireRsvp)),
          ScanRaw(tokenFor(inv)),
        );
        expect(d.outcome, expected);
      });
    }

    test('declining is refused whatever the policy says', () {
      final inv = household(rsvp: Rsvp.declined);
      final d = decide(
        ctx([inv],
            policy: const Policy(allowOverflow: true, requireRsvp: false)),
        ScanRaw(tokenFor(inv)),
      );
      expect(d.outcome, Outcome.rsvpDeclined);
    });

    test('override is offered only to ushers who hold the permission', () {
      final inv = household(rsvp: Rsvp.declined);

      final without = decide(ctx([inv]), ScanRaw(tokenFor(inv)));
      expect(without.actions, isNot(contains('Admit anyway')));

      final withPermission = decide(
        ctx([inv], canOverrideRsvp: true),
        ScanRaw(tokenFor(inv)),
      );
      expect(withPermission.actions, contains('Admit anyway'));
    });
  });

  // -------------------------------------------------------------------------

  group('manual check-in', () {
    test('skips every token check and is logged as manual', () {
      final inv = household(allowance: 1);
      final d = decide(ctx([inv]), ManualInput(inv.passId, requestedCount: 1));

      expect(d.outcome, Outcome.manual);
      expect(d.tone, Tone.admit);
      expect(d.admittedCount, 1);
    });

    test('a name that is not on the list offers a walk-in', () {
      final d = decide(ctx([]), ManualInput(randomUuid()));

      expect(d.outcome, Outcome.notFound);
      expect(d.actions, contains('Add walk-in'));
    });
  });

  // -------------------------------------------------------------------------

  group('invariants that must hold everywhere', () {
    List<Decision> everyScenario() {
      final good = household();
      final single = household(allowance: 1);
      final done = household(admitted: 4);
      final gone = household(revoked: true);
      final no = household(rsvp: Rsvp.declined);

      return [
        decide(ctx([single]), ScanRaw(tokenFor(single))),
        decide(ctx([good]), ScanRaw(tokenFor(good))),
        decide(ctx([good]), ScanRaw(tokenFor(good), requestedCount: 2)),
        decide(ctx([good]), ScanRaw(tokenFor(good), requestedCount: 9)),
        decide(
          ctx([done],
              policy: const Policy(allowOverflow: false, requireRsvp: false)),
          ScanRaw(tokenFor(done)),
        ),
        decide(ctx([gone]), ScanRaw(tokenFor(gone))),
        decide(ctx([no]), ScanRaw(tokenFor(no))),
        decide(ctx([]), const ScanRaw('rubbish')),
        decide(ctx([]), ManualInput(randomUuid())),
      ];
    }

    test('only green outcomes reset the camera by themselves', () {
      for (final d in everyScenario()) {
        if (d.autoReturnMs != null) {
          expect(
            d.tone == Tone.admit || d.outcome == Outcome.overflowAdmitted,
            isTrue,
            reason: '${d.outcome.wire} auto-returned but is not an admission',
          );
        }
      }
    });

    test('nothing is admitted on a refusal', () {
      const refusals = {
        Outcome.invalid,
        Outcome.wrongEvent,
        Outcome.wrongLeg,
        Outcome.revoked,
        Outcome.rsvpBlocked,
        Outcome.rsvpDeclined,
        Outcome.allowanceExhausted,
        Outcome.overflowBlocked,
        Outcome.notFound,
      };
      for (final d in everyScenario()) {
        if (refusals.contains(d.outcome)) {
          expect(d.admittedCount, 0);
        }
      }
    });

    test('every refusal is recorded — the organiser wants that report', () {
      for (final d in everyScenario()) {
        if (d.tone == Tone.deny || d.tone == Tone.hold) {
          expect(d.log, isTrue, reason: '${d.outcome.wire} was not logged');
        }
      }
    });

    test('only the count prompt goes unlogged', () {
      for (final d in everyScenario()) {
        if (!d.log) expect(d.outcome, Outcome.needsCount);
      }
    });

    test("no refusal leaks another household's identity", () {
      final foreign = issueToken(
        TokenPayload(
            passId: randomUuid(), eventId: otherWedding, tokenVersion: 1),
        otherKey.key,
      );
      final d = decide(ctx([]), ScanRaw(foreign));
      expect(d.invitation, isNull);
    });

    test('every outcome gives the usher something to read', () {
      for (final d in everyScenario()) {
        expect(d.headline, isNotEmpty);
      }
    });
  });

  // -------------------------------------------------------------------------

  group('two phones, both offline, same pass', () {
    test("each admits independently — reconciliation is the server's job", () {
      final shared = household(allowance: 4);

      // Neither device has seen the other's scan.
      final mainGate = decide(
        ctx([shared]),
        ScanRaw(tokenFor(shared), requestedCount: 3),
      );
      final sideGate = decide(
        ctx([shared]),
        ScanRaw(tokenFor(shared), requestedCount: 2),
      );

      expect(mainGate.admittedCount, 3);
      expect(sideGate.admittedCount, 2);

      // Five admitted against an allowance of four. Both rows are kept, the
      // server flags the overlap, and nobody already inside is thrown out.
      expect(mainGate.admittedCount + sideGate.admittedCount, 5);
      expect(mainGate.log && sideGate.log, isTrue);
    });
  });
}
