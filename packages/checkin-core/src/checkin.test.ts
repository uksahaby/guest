import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { issueToken, verifyToken, type EventKey } from "./token.ts";
import { decide, type Context, type LocalInvitation, type Rsvp } from "./checkin.ts";

// ---------------------------------------------------------------------------
// fixtures — Ahmed & Aisha, Lagos leg
// ---------------------------------------------------------------------------

const WEDDING = randomUUID();
const OTHER_WEDDING = randomUUID();
const LAGOS_LEG = randomUUID();

const weddingKey: EventKey = {
  eventId: WEDDING,
  eventName: "Ahmed & Aisha",
  tokenVersion: 1,
  key: randomBytes(32),
};
const otherKey: EventKey = {
  eventId: OTHER_WEDDING,
  eventName: "Yusuf & Maryam",
  tokenVersion: 1,
  key: randomBytes(32),
};

function household(over: Partial<LocalInvitation> = {}): LocalInvitation {
  return {
    passId: randomUUID(),
    invitationId: randomUUID(),
    eventId: WEDDING,
    legId: LAGOS_LEG,
    displayName: "Mr & Mrs Adeyemi",
    category: "Groom's Family",
    tableName: "Table 12",
    allowance: 4,
    admitted: 0,
    rsvp: "attending",
    revoked: false,
    ...over,
  };
}

function ctx(list: LocalInvitation[], over: Partial<Context> = {}): Context {
  const byId = new Map(list.map((i) => [i.passId, i]));
  return {
    currentEventId: WEDDING,
    currentLegId: LAGOS_LEG,
    policy: { allowOverflow: true, requireRsvp: false },
    keys: [weddingKey, otherKey],
    find: (id) => byId.get(id),
    canOverrideRsvp: false,
    ...over,
  };
}

const tokenFor = (inv: LocalInvitation, key = weddingKey, version = 1) =>
  issueToken({ passId: inv.passId, eventId: inv.eventId, tokenVersion: version }, key.key);

// ---------------------------------------------------------------------------

describe("token", () => {
  test("round trips and stays short enough for a low-density QR", () => {
    const inv = household();
    const t = tokenFor(inv);
    assert.ok(t.length < 80, `token was ${t.length} chars`);

    const v = verifyToken(t, [weddingKey]);
    assert.ok(v.ok);
    assert.equal(v.payload.passId, inv.passId);
    assert.equal(v.payload.eventId, WEDDING);
  });

  test("rejects a tampered payload", () => {
    const inv = household();
    const t = tokenFor(inv);
    const parts = t.split(".");
    // Replace the last char with one that differs from it — a quarter of
    // random uuids already end in "A", and "forging" a token into itself
    // is no forgery at all.
    const swap = parts[0].endsWith("A") ? "B" : "A";
    const forged = [parts[0].slice(0, -1) + swap, parts[1], parts[2], parts[3]].join(".");
    assert.equal(verifyToken(forged, [weddingKey]).ok, false);
  });

  test("rejects a signature from an unknown key", () => {
    const stranger = randomBytes(32);
    const t = issueToken({ passId: randomUUID(), eventId: WEDDING, tokenVersion: 1 }, stranger);
    assert.equal(verifyToken(t, [weddingKey]).ok, false);
  });

  test("identifies which held event a foreign pass belongs to", () => {
    const t = issueToken(
      { passId: randomUUID(), eventId: OTHER_WEDDING, tokenVersion: 1 },
      otherKey.key,
    );
    const v = verifyToken(t, [weddingKey, otherKey]);
    assert.ok(v.ok);
    assert.equal(v.matched.eventName, "Yusuf & Maryam");
  });

  test("a version bump kills every old pass at once", () => {
    const inv = household();
    const old = tokenFor(inv, weddingKey, 1);
    const reissued: EventKey = { ...weddingKey, tokenVersion: 2 };
    const v = verifyToken(old, [reissued]);
    assert.equal(v.ok, false);
    assert.equal((v as { reason: string }).reason, "stale_version");
  });

  test("garbage in, malformed out", () => {
    for (const junk of ["", "hello", "a.b.c", "a.b.c.d.e", "....", "https://example.com"]) {
      assert.equal(verifyToken(junk, [weddingKey]).ok, false);
    }
  });
});

// ---------------------------------------------------------------------------

describe("admitting", () => {
  test("a single guest goes straight through with no prompt", () => {
    const inv = household({ allowance: 1, displayName: "Chidinma Okafor", tableName: "Table 7" });
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv) });

    assert.equal(d.outcome, "admitted");
    assert.equal(d.tone, "admit");
    assert.equal(d.admittedCount, 1);
    assert.equal(d.remaining, 0);
    assert.equal(d.autoReturnMs, 1500, "must return to camera on its own");
    assert.ok(d.log);
  });

  test("a party of four is asked how many arrived", () => {
    const inv = household();
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv) });

    assert.equal(d.outcome, "needs_count");
    assert.equal(d.tone, "ask");
    assert.deepEqual(d.choices, [1, 2, 3, 4]);
    assert.equal(d.remaining, 4);
    assert.equal(d.log, false, "the prompt itself is not a log row");
    assert.equal(d.autoReturnMs, null);
  });

  test("three of four is a partial admit and the pass stays live", () => {
    const inv = household();
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv), requestedCount: 3 });

    assert.equal(d.outcome, "partial");
    assert.equal(d.tone, "admit");
    assert.equal(d.admittedCount, 3);
    assert.equal(d.remaining, 1);
    assert.equal(d.autoReturnMs, 2500, "longer dwell — there is a number to read");
  });

  test("the fourth arriving later is admitted, not treated as a duplicate", () => {
    const inv = household({ admitted: 3 });
    const first = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv) });

    assert.equal(first.outcome, "needs_count");
    assert.deepEqual(first.choices, [1], "only one left to offer");

    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv), requestedCount: 1 });
    assert.equal(d.outcome, "admitted");
    assert.equal(d.remaining, 0);
  });

  test("taking all four at once completes the party", () => {
    const inv = household();
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv), requestedCount: 4 });
    assert.equal(d.outcome, "admitted");
    assert.equal(d.remaining, 0);
  });
});

// ---------------------------------------------------------------------------

describe("allowance exhausted", () => {
  test("with overflow off, a fully admitted party is held", () => {
    const inv = household({ admitted: 4 });
    const d = decide(ctx([inv], { policy: { allowOverflow: false, requireRsvp: false } }), {
      kind: "scan",
      raw: tokenFor(inv),
    });

    assert.equal(d.outcome, "allowance_exhausted");
    assert.equal(d.tone, "hold");
    assert.equal(d.admittedCount, 0);
    assert.equal(d.autoReturnMs, null, "someone is talking at the gate — do not reset");
    assert.match(d.detail!, /4 of 4/);
  });

  test("with overflow on, the usher is offered the choice instead", () => {
    const inv = household({ admitted: 4 });
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv) });

    assert.equal(d.outcome, "needs_count");
    assert.equal(d.remaining, 0);
    assert.match(d.detail!, /over the invitation/);
  });
});

// ---------------------------------------------------------------------------

describe("overflow", () => {
  test("five through a party of four is admitted and flagged", () => {
    const inv = household({ displayName: "The Nwosu Family" });
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv), requestedCount: 5 });

    assert.equal(d.outcome, "overflow_admitted");
    assert.equal(d.tone, "hold", "amber, not green — it is a decision, not a routine admit");
    assert.equal(d.admittedCount, 5, "everyone standing there gets in");
    assert.match(d.detail!, /organiser has been notified/);
  });

  test("blocked when the organiser turned overflow off", () => {
    const inv = household();
    const d = decide(ctx([inv], { policy: { allowOverflow: false, requireRsvp: false } }), {
      kind: "scan",
      raw: tokenFor(inv),
      requestedCount: 5,
    });

    assert.equal(d.outcome, "overflow_blocked");
    assert.equal(d.tone, "deny");
    assert.equal(d.admittedCount, 0);
    assert.ok(d.actions.includes("Call manager"));
  });
});

// ---------------------------------------------------------------------------

describe("refusing", () => {
  test("a revoked pass names the household", () => {
    const inv = household({ revoked: true, displayName: "Tunde Bakare" });
    const d = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv) });

    assert.equal(d.outcome, "revoked");
    assert.equal(d.tone, "deny");
    assert.match(d.detail!, /Tunde Bakare/);
  });

  test("a pass from another wedding says which one", () => {
    const foreign = issueToken(
      { passId: randomUUID(), eventId: OTHER_WEDDING, tokenVersion: 1 },
      otherKey.key,
    );
    const d = decide(ctx([]), { kind: "scan", raw: foreign });

    assert.equal(d.outcome, "wrong_event");
    assert.match(d.detail!, /Yusuf & Maryam/, "this is the whole point of multi-key loading");
  });

  test("a genuine pass for the other leg is distinguished from a forgery", () => {
    const abujaOnly = household();
    // Signed for this event, but absent from the Lagos leg's list.
    const d = decide(ctx([]), { kind: "scan", raw: tokenFor(abujaOnly) });

    assert.equal(d.outcome, "wrong_leg");
    assert.notEqual(d.outcome, "invalid");
  });

  test("an unreadable code offers name search rather than dead-ending", () => {
    const d = decide(ctx([]), { kind: "scan", raw: "not-a-token" });

    assert.equal(d.outcome, "invalid");
    assert.ok(d.actions.includes("Search by name"), "usually a real guest with a broken screen");
  });

  test("a reissued pass reads as revoked, not invalid", () => {
    const inv = household();
    const old = tokenFor(inv, weddingKey, 1);
    const d = decide(ctx([inv], { keys: [{ ...weddingKey, tokenVersion: 2 }] }), {
      kind: "scan",
      raw: old,
    });

    assert.equal(d.outcome, "revoked");
    assert.match(d.detail!, /new link/);
  });
});

// ---------------------------------------------------------------------------

describe("the RSVP gate", () => {
  const cases: [Rsvp, boolean, string][] = [
    ["pending", false, "admitted"],
    ["pending", true, "rsvp_blocked"],
    ["attending", true, "needs_count"],
    ["partial", true, "needs_count"],
  ];

  for (const [rsvp, requireRsvp, expected] of cases) {
    test(`rsvp=${rsvp}, required=${requireRsvp} → ${expected}`, () => {
      const inv = household({ rsvp, allowance: rsvp === "pending" ? 1 : 4 });
      const d = decide(ctx([inv], { policy: { allowOverflow: true, requireRsvp } }), {
        kind: "scan",
        raw: tokenFor(inv),
      });
      assert.equal(d.outcome, expected);
    });
  }

  test("declining is refused whatever the policy says", () => {
    const inv = household({ rsvp: "declined" });
    const d = decide(ctx([inv], { policy: { allowOverflow: true, requireRsvp: false } }), {
      kind: "scan",
      raw: tokenFor(inv),
    });
    assert.equal(d.outcome, "rsvp_declined");
  });

  test("override is offered only to ushers who hold the permission", () => {
    const inv = household({ rsvp: "declined" });

    const without = decide(ctx([inv]), { kind: "scan", raw: tokenFor(inv) });
    assert.ok(!without.actions.includes("Admit anyway"));

    const with_ = decide(ctx([inv], { canOverrideRsvp: true }), {
      kind: "scan",
      raw: tokenFor(inv),
    });
    assert.ok(with_.actions.includes("Admit anyway"));
  });
});

// ---------------------------------------------------------------------------

describe("manual check-in", () => {
  test("skips every token check and is logged as manual", () => {
    const inv = household({ allowance: 1 });
    const d = decide(ctx([inv]), { kind: "manual", passId: inv.passId, requestedCount: 1 });

    assert.equal(d.outcome, "manual");
    assert.equal(d.tone, "admit");
    assert.equal(d.admittedCount, 1);
  });

  test("a name that is not on the list offers a walk-in", () => {
    const d = decide(ctx([]), { kind: "manual", passId: randomUUID() });

    assert.equal(d.outcome, "not_found");
    assert.ok(d.actions.includes("Add walk-in"));
  });
});

// ---------------------------------------------------------------------------

describe("invariants that must hold everywhere", () => {
  const everyScenario = () => {
    const good = household();
    const single = household({ allowance: 1 });
    const done = household({ admitted: 4 });
    const gone = household({ revoked: true });
    const no = household({ rsvp: "declined" });

    return [
      decide(ctx([single]), { kind: "scan", raw: tokenFor(single) }),
      decide(ctx([good]), { kind: "scan", raw: tokenFor(good) }),
      decide(ctx([good]), { kind: "scan", raw: tokenFor(good), requestedCount: 2 }),
      decide(ctx([good]), { kind: "scan", raw: tokenFor(good), requestedCount: 9 }),
      decide(ctx([done], { policy: { allowOverflow: false, requireRsvp: false } }), {
        kind: "scan",
        raw: tokenFor(done),
      }),
      decide(ctx([gone]), { kind: "scan", raw: tokenFor(gone) }),
      decide(ctx([no]), { kind: "scan", raw: tokenFor(no) }),
      decide(ctx([]), { kind: "scan", raw: "rubbish" }),
      decide(ctx([]), { kind: "manual", passId: randomUUID() }),
    ];
  };

  test("only green outcomes reset the camera by themselves", () => {
    for (const d of everyScenario()) {
      if (d.autoReturnMs !== null) {
        assert.equal(d.tone === "admit" || d.outcome === "overflow_admitted", true,
          `${d.outcome} auto-returned but is not an admission`);
      }
    }
  });

  test("nothing is admitted on a refusal", () => {
    const refusals = new Set([
      "invalid", "wrong_event", "wrong_leg", "revoked",
      "rsvp_blocked", "rsvp_declined", "allowance_exhausted",
      "overflow_blocked", "not_found",
    ]);
    for (const d of everyScenario()) {
      if (refusals.has(d.outcome)) assert.equal(d.admittedCount, 0);
    }
  });

  test("every refusal is recorded — the organiser wants that report", () => {
    for (const d of everyScenario()) {
      if (d.tone === "deny" || d.tone === "hold") assert.ok(d.log, `${d.outcome} was not logged`);
    }
  });

  test("only the count prompt goes unlogged", () => {
    for (const d of everyScenario()) {
      if (!d.log) assert.equal(d.outcome, "needs_count");
    }
  });

  test("no refusal leaks another household's identity", () => {
    const foreign = issueToken(
      { passId: randomUUID(), eventId: OTHER_WEDDING, tokenVersion: 1 },
      otherKey.key,
    );
    const d = decide(ctx([]), { kind: "scan", raw: foreign });
    assert.equal(d.invitation, undefined);
  });

  test("every outcome gives the usher something to read", () => {
    for (const d of everyScenario()) {
      assert.ok(d.headline.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------

describe("two phones, both offline, same pass", () => {
  test("each admits independently — reconciliation is the server's job", () => {
    const shared = household({ allowance: 4 });

    // Neither device has seen the other's scan.
    const mainGate = decide(ctx([{ ...shared }]), {
      kind: "scan",
      raw: tokenFor(shared),
      requestedCount: 3,
    });
    const sideGate = decide(ctx([{ ...shared }]), {
      kind: "scan",
      raw: tokenFor(shared),
      requestedCount: 2,
    });

    assert.equal(mainGate.admittedCount, 3);
    assert.equal(sideGate.admittedCount, 2);

    // Five admitted against an allowance of four. Both rows are kept, the
    // server flags the overlap, and nobody already inside is thrown out.
    assert.equal(mainGate.admittedCount + sideGate.admittedCount, 5);
    assert.ok(mainGate.log && sideGate.log);
  });
});
