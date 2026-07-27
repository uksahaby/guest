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
