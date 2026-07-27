// The web scanner's one endpoint: the gate, decided on the server.
//
// The reason this exists rather than a browser port of decide() is
// HANDOFF §5 — decide() exists at most twice. So the thing under test here
// is mostly that this route is a faithful pipe to the same state machine,
// and that it writes the same rows the sync endpoint would.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { seedEvent, passTokenFor, type Seeded } from "./testutil.ts";

const app = buildServer();
after(async () => {
  await app.close();
  await closeDb();
});

function scan(
  s: Seeded,
  body: Record<string, unknown>,
  token = s.usherToken,
) {
  return app.inject({
    method: "POST",
    url: `/scanner/legs/${s.legId}/scan`,
    headers: { authorization: `Bearer ${token}` },
    payload: { client_uuid: randomUUID(), entrance_id: s.entranceId, ...body },
  });
}

// ---- the happy path ------------------------------------------------------

test("a valid pass asks how many arrived, and writes nothing yet", async () => {
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);

  const res = await scan(s, { raw });
  assert.equal(res.statusCode, 200);
  const { decision, recorded } = res.json();

  assert.equal(decision.outcome, "needs_count");
  assert.equal(decision.invitation.displayName, "Mr & Mrs Adeyemi");
  assert.equal(recorded, null, "the usher is still being asked — nothing happened");

  const [rows] = await sql`
    select count(*)::int as n from check_in_events where leg_id = ${s.legId}`;
  assert.equal(rows!.n, 0);
});

test("confirming a count admits them and appends one row", async () => {
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);

  const res = await scan(s, { raw, requested_count: 3 });
  const { decision, recorded } = res.json();

  assert.equal(decision.outcome, "partial");
  assert.equal(decision.admittedCount, 3);
  assert.ok(recorded, "an admission must be recorded");

  const [row] = await sql`
    select result, admitted_count, occupancy_delta, staff_user_id, device_id
    from check_in_events where id = ${recorded}`;
  assert.equal(row!.result, "partial");
  assert.equal(row!.admitted_count, 3);
  assert.equal(row!.occupancy_delta, 3);
  assert.equal(row!.staff_user_id, s.usherId, "attributed to the usher, not a device");
  assert.equal(row!.device_id, "web");
});

test("the fourth guest is admitted later, on the same pass", async () => {
  // The household model, through the web surface: a second scan is not
  // fraud, it is the one who was still parking.
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);

  await scan(s, { raw, requested_count: 3 });
  const res = await scan(s, { raw, requested_count: 1 });
  const { decision } = res.json();

  assert.equal(decision.admittedCount, 1);
  assert.equal(decision.remaining, 0);
});

// ---- refusals ------------------------------------------------------------

test("refusals are recorded, because the refusal log is the point", async () => {
  const s = await seedEvent(app);
  const res = await scan(s, { raw: "not-a-token" });
  const { decision, recorded } = res.json();

  assert.equal(decision.outcome, "invalid");
  assert.ok(recorded, "a refused attempt is still something that happened");

  const [row] = await sql`
    select result, admitted_count, occupancy_delta
    from check_in_events where id = ${recorded}`;
  assert.equal(row!.result, "invalid");
  assert.equal(row!.admitted_count, 0);
  assert.equal(row!.occupancy_delta, 0, "a refusal moves no count");
});

test("a pass for another event is named when the usher works both", async () => {
  // Naming it requires holding that event's key, and usher_event_keys only
  // carries events this usher actually works — the same rule the Flutter
  // bootstrap follows. So this is the double-booked usher, which is the
  // case the feature is for.
  const a = await seedEvent(app);
  const b = await seedEvent(app);
  await sql`insert into staff_assignments (user_id, leg_id)
    values (${a.usherId}, ${b.legId})`;
  const foreign = await passTokenFor(b.passId, b.eventId);

  const { decision } = (await scan(a, { raw: foreign })).json();
  assert.equal(decision.outcome, "wrong_event");
  assert.match(decision.detail, /Test Wedding/);
});

test("a pass from an event the usher does not work cannot be named", async () => {
  // No key, so no signature to check. "Not a valid pass" is the honest
  // answer — the alternative is claiming to recognise something we cannot.
  const a = await seedEvent(app);
  const b = await seedEvent(app);
  const foreign = await passTokenFor(b.passId, b.eventId);

  const { decision } = (await scan(a, { raw: foreign })).json();
  assert.equal(decision.outcome, "invalid");
});

test("a cancelled event refuses through this route too", async () => {
  // Otherwise the web scanner is a way around the cancellation.
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);
  await sql`update events set status = 'cancelled' where id = ${s.eventId}`;

  const { decision } = (await scan(s, { raw })).json();
  assert.equal(decision.outcome, "event_cancelled");
  assert.equal(decision.admittedCount, 0);
});

// ---- who may use it ------------------------------------------------------

test("someone with no assignment on the leg is refused", async () => {
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);

  const res = await scan(s, { raw }, s.outsiderToken);
  assert.equal(res.statusCode, 403);
});

test("it needs a session at all", async () => {
  const s = await seedEvent(app);
  const res = await app.inject({
    method: "POST",
    url: `/scanner/legs/${s.legId}/scan`,
    payload: { raw: "x", client_uuid: randomUUID() },
  });
  assert.equal(res.statusCode, 401);
});

// ---- idempotency ---------------------------------------------------------

test("a repeated client_uuid admits once, not twice", async () => {
  // A double-tap, or a retry after a slow response, must not put a second
  // admission into an append-only log that cannot be edited afterwards.
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);
  const clientUuid = randomUUID();

  const first = await scan(s, { raw, requested_count: 2, client_uuid: clientUuid });
  const second = await scan(s, { raw, requested_count: 2, client_uuid: clientUuid });

  assert.equal(first.json().duplicate, false);
  assert.equal(second.json().duplicate, true);
  assert.equal(second.json().recorded, first.json().recorded);

  const [rows] = await sql`
    select count(*)::int as n from check_in_events where leg_id = ${s.legId}`;
  assert.equal(rows!.n, 1);
});

test("a client_uuid is required, and must be a uuid", async () => {
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);

  const missing = await app.inject({
    method: "POST",
    url: `/scanner/legs/${s.legId}/scan`,
    headers: { authorization: `Bearer ${s.usherToken}` },
    payload: { raw },
  });
  assert.equal(missing.statusCode, 400);

  const junk = await scan(s, { raw, client_uuid: "not-a-uuid" });
  assert.equal(junk.statusCode, 400);
});

test("an empty scan is a bad request, not a refusal row", async () => {
  const s = await seedEvent(app);
  const res = await scan(s, { raw: "   " });
  assert.equal(res.statusCode, 400);

  const [rows] = await sql`
    select count(*)::int as n from check_in_events where leg_id = ${s.legId}`;
  assert.equal(rows!.n, 0);
});

// ---- it is the same state machine ---------------------------------------

test("the web route and the sync route agree on the same pass", async () => {
  // If these ever disagree, decide() has been forked in spirit even though
  // it has not been forked in code.
  const s = await seedEvent(app);
  const raw = await passTokenFor(s.passId, s.eventId);

  // Spend the whole allowance through the web route.
  await scan(s, { raw, requested_count: 4 });

  // Now the sync route re-runs decide() for a device that admitted anyway.
  const sync = await app.inject({
    method: "POST",
    url: "/scanner/check-ins",
    headers: { authorization: `Bearer ${s.usherToken}` },
    payload: {
      items: [
        {
          client_uuid: randomUUID(),
          leg_id: s.legId,
          entrance_id: s.entranceId,
          pass_id: s.passId,
          result: "admitted",
          admitted_count: 1,
          scanned_at: new Date().toISOString(),
          device_id: "phone",
        },
      ],
    },
  });
  const [out] = sync.json().results;
  assert.equal(out.accepted, true, "the people are already inside");
  assert.equal(out.contested, true, "but the server knows the allowance was spent");
});

// ---- find them by hand ---------------------------------------------------

function guests(s: Seeded, q: string, token = s.usherToken) {
  return app.inject({
    method: "GET",
    url: `/scanner/legs/${s.legId}/guests?q=${encodeURIComponent(q)}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

test("searching by name finds a household", async () => {
  const s = await seedEvent(app);
  const res = await guests(s, "adeyemi");
  assert.equal(res.statusCode, 200);

  const [g] = res.json().guests;
  assert.equal(g.display_name, "Mr & Mrs Adeyemi");
  assert.equal(g.allowance, 4);
  assert.equal(g.admitted, 0);
  assert.ok(g.pass_id);
});

test("search never hands a browser a signing key or a phone number", async () => {
  // The reason this endpoint exists instead of reusing bootstrap.
  const s = await seedEvent(app);
  const body = (await guests(s, "adeyemi")).body;
  assert.ok(!body.includes("signing"), "no key material");
  assert.ok(!body.includes("+234"), "no phone numbers");
});

test("search needs three characters", async () => {
  const s = await seedEvent(app);
  assert.deepEqual((await guests(s, "ad")).json().guests, []);
});

test("search is refused without an assignment on the leg", async () => {
  const s = await seedEvent(app);
  assert.equal((await guests(s, "adeyemi", s.outsiderToken)).statusCode, 403);
});

test("a household found by name can be checked in by hand", async () => {
  const s = await seedEvent(app);
  const [g] = (await guests(s, "adeyemi")).json().guests;

  const res = await scan(s, { pass_id: g.pass_id, requested_count: 2 });
  const { decision, recorded } = res.json();
  assert.equal(decision.outcome, "manual");
  assert.equal(decision.admittedCount, 2);

  const [row] = await sql`
    select result, admitted_count from check_in_events where id = ${recorded}`;
  assert.equal(row!.result, "manual");
  assert.equal(row!.admitted_count, 2);
});

test("a cancelled event refuses a manual check-in too", async () => {
  // Search by name must not be the way around it here either.
  const s = await seedEvent(app);
  const [g] = (await guests(s, "adeyemi")).json().guests;
  await sql`update events set status = 'cancelled' where id = ${s.eventId}`;

  const { decision } = (await scan(s, { pass_id: g.pass_id })).json();
  assert.equal(decision.outcome, "event_cancelled");
});

test("a pass_id must be a uuid, and one of raw or pass_id is required", async () => {
  const s = await seedEvent(app);
  assert.equal((await scan(s, { pass_id: "nope" })).statusCode, 400);
  assert.equal((await scan(s, {})).statusCode, 400);
});

// ---- walk-ins ------------------------------------------------------------
//
// Not an edge case at a Nigerian wedding — the first hour. A walk-in
// becomes a real household so they can leave and come back, and so the
// organiser is invoiced for them afterwards rather than blocked at the
// gate (HANDOFF §3).

function walkIn(s: Seeded, body: Record<string, unknown> = {}, token = s.usherToken) {
  return app.inject({
    method: "POST",
    url: `/scanner/legs/${s.legId}/walk-ins`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      client_uuid: randomUUID(),
      display_name: "Uninvited Uncle",
      count: 2,
      entrance_id: s.entranceId,
      ...body,
    },
  });
}

/** can_walk_in defaults closed, so grant it explicitly. */
async function allowWalkIns(s: Seeded) {
  await sql`update staff_assignments set can_walk_in = true
    where leg_id = ${s.legId} and user_id = ${s.usherId}`;
}

test("a walk-in becomes a household, a pass, and an admission", async () => {
  const s = await seedEvent(app);
  await allowWalkIns(s);

  const res = await walkIn(s);
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.admitted, 2);

  const [inv] = await sql`
    select display_name, is_walk_in from invitations where id = ${out.invitation_id}`;
  assert.equal(inv!.display_name, "Uninvited Uncle");
  assert.equal(inv!.is_walk_in, true, "must be distinguishable from a real invitation");

  const [row] = await sql`
    select result, admitted_count, occupancy_delta, staff_user_id
    from check_in_events where id = ${out.recorded}`;
  assert.equal(row!.admitted_count, 2);
  assert.equal(row!.occupancy_delta, 2);
  assert.equal(row!.staff_user_id, s.usherId);

  // An allowance to count against, so stepping out and back in works.
  const [ent] = await sql`
    select allowance from invitation_legs
    where invitation_id = ${out.invitation_id} and leg_id = ${s.legId}`;
  assert.equal(ent!.allowance, 2);
});

test("a walk-in can be scanned back in after stepping out", async () => {
  // The reason they get a real pass rather than a bare log row.
  const s = await seedEvent(app);
  await allowWalkIns(s);
  const out = (await walkIn(s, { count: 2 })).json();

  const again = await scan(s, { pass_id: out.pass_id });
  const { decision } = again.json();
  assert.equal(decision.outcome, "needs_count");
  assert.equal(decision.invitation.displayName, "Uninvited Uncle");
});

test("a walk-in counts towards the bill", async () => {
  // HANDOFF §3: admitted now, invoiced afterwards. Blocking them is the
  // one thing that must not happen.
  const s = await seedEvent(app);
  await allowWalkIns(s);
  const [before] = await sql`select billable_people(${s.eventId}::uuid) as n`;
  await walkIn(s, { count: 3 });
  const [after] = await sql`select billable_people(${s.eventId}::uuid) as n`;
  assert.equal(after!.n, before!.n + 3);
});

test("the three gates all default closed", async () => {
  const s = await seedEvent(app);

  // 1. can_walk_in is off unless the organiser grants it.
  assert.equal((await walkIn(s)).statusCode, 403);
  await allowWalkIns(s);
  assert.equal((await walkIn(s)).statusCode, 200);

  // 2. the event may forbid walk-ins outright.
  await sql`update events set allow_walkins = false where id = ${s.eventId}`;
  const forbidden = await walkIn(s);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().code, "walkins_not_allowed");

  // 3. a cancelled event admits nobody, walk-in or otherwise.
  await sql`update events set allow_walkins = true, status = 'cancelled'
    where id = ${s.eventId}`;
  const cancelled = await walkIn(s);
  assert.equal(cancelled.statusCode, 409);
  assert.equal(cancelled.json().code, "event_cancelled");
});

test("someone off the leg cannot add a walk-in", async () => {
  const s = await seedEvent(app);
  await allowWalkIns(s);
  assert.equal((await walkIn(s, {}, s.outsiderToken)).statusCode, 403);
});

test("a walk-in needs a name and a sane count", async () => {
  const s = await seedEvent(app);
  await allowWalkIns(s);

  // Nameless walk-ins make the refusal log useless to the organiser.
  assert.equal((await walkIn(s, { display_name: "  " })).statusCode, 400);
  assert.equal((await walkIn(s, { count: 0 })).statusCode, 400);
  assert.equal((await walkIn(s, { count: 51 })).statusCode, 400);
  assert.equal((await walkIn(s, { count: 2.5 })).statusCode, 400);
});

test("a retried walk-in does not invent a second household", async () => {
  const s = await seedEvent(app);
  await allowWalkIns(s);
  const clientUuid = randomUUID();

  const first = await walkIn(s, { client_uuid: clientUuid });
  const second = await walkIn(s, { client_uuid: clientUuid });

  assert.equal(first.json().duplicate, false);
  assert.equal(second.json().duplicate, true);
  assert.equal(second.json().recorded, first.json().recorded);

  const [rows] = await sql`
    select count(*)::int as n from invitations
    where event_id = ${s.eventId} and is_walk_in = true`;
  assert.equal(rows!.n, 1, "a retry must not double the guest list");
});
