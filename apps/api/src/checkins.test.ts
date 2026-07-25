// Phase-4C behaviours as the endpoint's specification.
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sql } from "./db.ts";

const app = buildServer();
after(async () => {
  await app.close();
  await sql.end();
});

// ---------------------------------------------------------------- helpers

type Seeded = {
  eventId: string;
  legId: string;
  entranceId: string;
  usherId: string;
  usherToken: string;
  outsiderToken: string;
  /** allowance-4 household */
  passId: string;
  invitationId: string;
  /** allowance-1 household */
  soloPassId: string;
};

async function seedEvent(opts?: {
  allowOverflow?: boolean;
  requireRsvp?: boolean;
  canOverride?: boolean;
}): Promise<Seeded> {
  const owner = randomUUID(), usher = randomUUID(), outsider = randomUUID();
  const ws = randomUUID(), event = randomUUID(), leg = randomUUID();
  const entrance = randomUUID();
  const inv = randomUUID(), pass = randomUUID();
  const soloInv = randomUUID(), soloPass = randomUUID();

  const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

  await sql`insert into users (id, phone, full_name) values
    (${owner}, ${phone()}, 'Owner'),
    (${usher}, ${phone()}, 'Usher Musa'),
    (${outsider}, ${phone()}, 'Not Staff')`;
  await sql`insert into workspaces (id, name, owner_user_id) values (${ws}, 'WS', ${owner})`;
  await sql`insert into events (id, workspace_id, name, signing_key, status,
      allow_overflow, require_rsvp)
    values (${event}, ${ws}, 'Test Wedding', gen_random_bytes(32), 'active',
      ${opts?.allowOverflow ?? true}, ${opts?.requireRsvp ?? false})`;
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${leg}, ${event}, 'Main', 1, now())`;
  await sql`insert into entrances (id, leg_id, name) values (${entrance}, ${leg}, 'Main Gate')`;
  await sql`insert into staff_assignments (user_id, leg_id, entrance_id, can_manual, can_override)
    values (${usher}, ${leg}, ${entrance}, true, ${opts?.canOverride ?? false})`;

  await sql`insert into invitations (id, event_id, display_name)
    values (${inv}, ${event}, 'Mr & Mrs Adeyemi'), (${soloInv}, ${event}, 'Chidinma Okafor')`;
  await sql`insert into invitation_legs (invitation_id, leg_id, allowance) values
    (${inv}, ${leg}, 4), (${soloInv}, ${leg}, 1)`;
  await sql`insert into passes (id, invitation_id, event_id) values
    (${pass}, ${inv}, ${event}), (${soloPass}, ${soloInv}, ${event})`;

  return {
    eventId: event,
    legId: leg,
    entranceId: entrance,
    usherId: usher,
    usherToken: app.jwt.sign({ sub: usher }),
    outsiderToken: app.jwt.sign({ sub: outsider }),
    passId: pass,
    invitationId: inv,
    soloPassId: soloPass,
  };
}

function item(s: Seeded, over: Partial<Record<string, unknown>> = {}) {
  return {
    client_uuid: randomUUID(),
    leg_id: s.legId,
    entrance_id: s.entranceId,
    pass_id: s.passId,
    result: "admitted",
    admitted_count: 4,
    scanned_at: new Date().toISOString(),
    device_id: "test-device",
    ...over,
  };
}

async function submit(token: string, items: unknown[]) {
  const res = await app.inject({
    method: "POST",
    url: "/scanner/check-ins",
    headers: { authorization: `Bearer ${token}` },
    payload: { items },
  });
  return res;
}

async function admittedSum(passId: string, legId: string): Promise<number> {
  const [row] = await sql`select admitted_so_far(${passId}::uuid, ${legId}::uuid) as n`;
  return row!.n;
}

// ------------------------------------------------------------------ auth

test("rejects requests without a token", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/scanner/check-ins",
    payload: { items: [] },
  });
  assert.equal(res.statusCode, 401);
});

test("rejects an empty or oversized batch", async () => {
  const s = await seedEvent();
  assert.equal((await submit(s.usherToken, [])).statusCode, 400);
  const many = Array.from({ length: 501 }, () => item(s));
  assert.equal((await submit(s.usherToken, many)).statusCode, 400);
});

// ----------------------------------------------------- plain admissions

test("admits a full party and the log sum reflects it", async () => {
  const s = await seedEvent();
  const res = await submit(s.usherToken, [item(s)]);
  assert.equal(res.statusCode, 200);
  const [r] = res.json().results;
  assert.deepEqual(
    { accepted: r.accepted, duplicate: r.duplicate, contested: r.contested },
    { accepted: true, duplicate: false, contested: false },
  );
  assert.ok(r.id);
  assert.equal(await admittedSum(s.passId, s.legId), 4);
});

test("partial arrival, then the rest of the family later", async () => {
  const s = await seedEvent();
  const first = await submit(s.usherToken, [item(s, { result: "partial", admitted_count: 3 })]);
  assert.equal(first.json().results[0].contested, false);
  assert.equal(await admittedSum(s.passId, s.legId), 3);

  const second = await submit(s.usherToken, [item(s, { result: "admitted", admitted_count: 1 })]);
  assert.equal(second.json().results[0].contested, false);
  assert.equal(await admittedSum(s.passId, s.legId), 4);
});

// ---------------------------------------------------------- idempotency

test("replaying a client_uuid returns the stored outcome, admits nobody twice", async () => {
  const s = await seedEvent();
  const one = item(s);
  const a = await submit(s.usherToken, [one]);
  const b = await submit(s.usherToken, [one]); // the flaky-connection retry
  const ra = a.json().results[0], rb = b.json().results[0];
  assert.equal(ra.duplicate, false);
  assert.equal(rb.duplicate, true);
  assert.equal(rb.accepted, true);
  assert.equal(rb.id, ra.id);
  assert.equal(await admittedSum(s.passId, s.legId), 4);
});

// ------------------------------------------- two offline phones, one pass

test("two devices, both offline, same pass: both land, second contested, nobody denied", async () => {
  const s = await seedEvent();
  // Each device believed it admitted the full party of 4.
  const a = await submit(s.usherToken, [item(s, { device_id: "phone-A" })]);
  const b = await submit(s.usherToken, [item(s, { device_id: "phone-B" })]);
  const ra = a.json().results[0], rb = b.json().results[0];

  assert.equal(ra.accepted, true);
  assert.equal(ra.contested, false);
  // The second row is ACCEPTED — the people are already inside — but flagged.
  assert.equal(rb.accepted, true);
  assert.equal(rb.contested, true);
  // The sum honestly exceeds allowance; nothing was rewritten.
  assert.equal(await admittedSum(s.passId, s.legId), 8);
});

// -------------------------------------------------------------- refusals

test("a refusal is recorded and admits nobody", async () => {
  const s = await seedEvent();
  const res = await submit(s.usherToken, [
    item(s, { result: "revoked", admitted_count: 0 }),
  ]);
  const [r] = res.json().results;
  assert.equal(r.accepted, true);
  assert.equal(await admittedSum(s.passId, s.legId), 0);
  const rows = await sql`select result, admitted_count from check_in_events
    where pass_id = ${s.passId}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.result, "revoked");
  assert.equal(rows[0]!.admitted_count, 0);
});

test("a refusal claiming to admit people is structurally rejected", async () => {
  const s = await seedEvent();
  const res = await submit(s.usherToken, [
    item(s, { result: "rsvp_blocked", admitted_count: 2 }),
  ]);
  const [r] = res.json().results;
  assert.equal(r.accepted, false);
  assert.equal(r.error.code, "count_mismatch");
});

// -------------------------------------------------------------- overflow

test("deliberate overflow on an allowing event is accepted, not contested", async () => {
  const s = await seedEvent({ allowOverflow: true });
  await submit(s.usherToken, [item(s)]); // 4 of 4 in
  const res = await submit(s.usherToken, [
    item(s, { result: "overflow_admitted", admitted_count: 1 }),
  ]);
  const [r] = res.json().results;
  assert.equal(r.accepted, true);
  assert.equal(r.contested, false);
  assert.equal(await admittedSum(s.passId, s.legId), 5);
});

test("overflow on a blocking event is recorded but contested", async () => {
  const s = await seedEvent({ allowOverflow: false });
  await submit(s.usherToken, [item(s)]);
  const res = await submit(s.usherToken, [
    item(s, { result: "overflow_admitted", admitted_count: 1 }),
  ]);
  const [r] = res.json().results;
  assert.equal(r.accepted, true); // the person is inside; never retro-deny
  assert.equal(r.contested, true);
});

// -------------------------------------------------------------- reversal

test("a mis-tap is corrected by a reversal row, never a delete", async () => {
  const s = await seedEvent();
  const wrong = item(s); // "Admit 4" when only 2 arrived
  await submit(s.usherToken, [wrong]);

  const undo = item(s, {
    result: "reversal",
    admitted_count: -4,
    reverses_client_uuid: wrong.client_uuid,
  });
  const res = await submit(s.usherToken, [undo]);
  assert.equal(res.json().results[0].accepted, true);
  assert.equal(await admittedSum(s.passId, s.legId), 0);

  // Now the real admission goes through cleanly.
  const redo = await submit(s.usherToken, [item(s, { admitted_count: 2, result: "partial" })]);
  assert.equal(redo.json().results[0].contested, false);
  assert.equal(await admittedSum(s.passId, s.legId), 2);

  // Three rows in the log — the audit trail is complete.
  const rows = await sql`select count(*)::int as n from check_in_events
    where pass_id = ${s.passId}`;
  assert.equal(rows[0]!.n, 3);
});

test("a reversal can target an earlier item in the same batch", async () => {
  const s = await seedEvent();
  const wrong = item(s);
  const res = await submit(s.usherToken, [
    wrong,
    item(s, {
      result: "reversal",
      admitted_count: -4,
      reverses_client_uuid: wrong.client_uuid,
    }),
  ]);
  const [a, b] = res.json().results;
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, true);
  assert.equal(await admittedSum(s.passId, s.legId), 0);
});

test("reversal validation: wrong count, double undo, missing target", async () => {
  const s = await seedEvent();
  const wrong = item(s);
  await submit(s.usherToken, [wrong]);

  const short = await submit(s.usherToken, [item(s, {
    result: "reversal", admitted_count: -2, reverses_client_uuid: wrong.client_uuid,
  })]);
  assert.equal(short.json().results[0].error.code, "reversal_count_mismatch");

  const ok = await submit(s.usherToken, [item(s, {
    result: "reversal", admitted_count: -4, reverses_client_uuid: wrong.client_uuid,
  })]);
  assert.equal(ok.json().results[0].accepted, true);

  const twice = await submit(s.usherToken, [item(s, {
    result: "reversal", admitted_count: -4, reverses_client_uuid: wrong.client_uuid,
  })]);
  assert.equal(twice.json().results[0].error.code, "already_reversed");

  const ghost = await submit(s.usherToken, [item(s, {
    result: "reversal", admitted_count: -1, reverses_client_uuid: randomUUID(),
  })]);
  assert.equal(ghost.json().results[0].error.code, "reversal_target_missing");
});

// ------------------------------------------------------------ permissions

test("staff without an assignment on the leg is refused per item", async () => {
  const s = await seedEvent();
  const res = await submit(s.outsiderToken, [item(s)]);
  const [r] = res.json().results;
  assert.equal(r.accepted, false);
  assert.equal(r.error.code, "forbidden");
  assert.equal(await admittedSum(s.passId, s.legId), 0);
});

// -------------------------------------------- server disagreement flags

test("admission for a household not on this leg's list is contested, not lost", async () => {
  const s = await seedEvent();
  // A second leg the household is NOT invited to.
  const leg2 = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${leg2}, ${s.eventId}, 'Reception', 2, now())`;
  await sql`insert into staff_assignments (user_id, leg_id) values (${s.usherId}, ${leg2})`;

  const res = await submit(s.usherToken, [
    item(s, { leg_id: leg2, entrance_id: null, admitted_count: 2, result: "partial" }),
  ]);
  const [r] = res.json().results;
  assert.equal(r.accepted, true);
  assert.equal(r.contested, true);
});

test("admission on a revoked pass syncs contested, never denied", async () => {
  const s = await seedEvent();
  // Revoked while the device was offline.
  await sql`update passes set status = 'revoked', revoked_at = now()
    where id = ${s.passId}`;
  const res = await submit(s.usherToken, [item(s, { admitted_count: 4 })]);
  const [r] = res.json().results;
  assert.equal(r.accepted, true);
  assert.equal(r.contested, true);
  assert.equal(await admittedSum(s.passId, s.legId), 4);
});

// -------------------------------------------------------- batch semantics

test("partial success: one bad item does not sink the batch", async () => {
  const s = await seedEvent();
  const good = item(s, { pass_id: s.soloPassId, admitted_count: 1 });
  const badItem = item(s, { leg_id: randomUUID() }); // unknown leg
  const res = await submit(s.usherToken, [good, badItem]);
  const [a, b] = res.json().results;
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, false);
  assert.equal(b.error.code, "leg_not_found");
  assert.equal(await admittedSum(s.soloPassId, s.legId), 1);
});
