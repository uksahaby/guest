// Cancelling an event, end to end.
//
// The settings page has always told the organiser two things happen when
// they call an event off: "Guests see a cancellation notice on their
// invitation. Passes stop working." Neither did. These tests are the copy,
// turned into assertions.
//
// This is not a billing block — HANDOFF §3 forbids refusing a real person
// at a gate over money. Cancelling is the organiser deliberately calling
// the whole thing off, and it is reversible.
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

const cancel = (eventId: string) =>
  sql`update events set status = 'cancelled' where id = ${eventId}`;

const reinstate = (eventId: string) =>
  sql`update events set status = 'active' where id = ${eventId}`;

function scan(s: Seeded, passId: string, result: string) {
  return app.inject({
    method: "POST",
    url: "/scanner/check-ins",
    headers: { authorization: `Bearer ${s.usherToken}` },
    payload: {
      items: [
        {
          client_uuid: randomUUID(),
          leg_id: s.legId,
          entrance_id: s.entranceId,
          pass_id: passId,
          result,
          admitted_count: result === "event_cancelled" ? 0 : 1,
          scanned_at: new Date().toISOString(),
          device_id: "test-device",
        },
      ],
    },
  });
}

// ---- what the guest sees -------------------------------------------------

test("the guest page carries the cancellation, and still opens", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);

  const before = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(before.json().cancelled, false);

  await cancel(s.eventId);

  const after = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  // Deliberately not a 404: cancelling is reversible, and a guest who
  // opens the link after it is undone should find their invitation intact.
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().cancelled, true);
  assert.equal(after.json().event_name, "Test Wedding");
});

test("a cancelled event cannot be replied to", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);
  await cancel(s.eventId);

  const res = await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: s.legId, attending: true, count: 2 },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "event_cancelled");
});

// ---- what the gate does --------------------------------------------------

test("the scanner is told the event is cancelled when it bootstraps", async () => {
  const s = await seedEvent(app);

  const live = await app.inject({
    method: "GET",
    url: `/scanner/legs/${s.legId}/bootstrap`,
    headers: { authorization: `Bearer ${s.usherToken}` },
  });
  assert.equal(live.json().event.cancelled, false);

  await cancel(s.eventId);

  const off = await app.inject({
    method: "GET",
    url: `/scanner/legs/${s.legId}/bootstrap`,
    headers: { authorization: `Bearer ${s.usherToken}` },
  });
  // Carried in the payload so the refusal survives with no signal — the
  // promise is that passes stop working, not that they stop working when
  // the scanner happens to be online.
  assert.equal(off.json().event.cancelled, true);
});

test("an admission at a cancelled event is recorded but contested", async () => {
  const s = await seedEvent(app);
  await cancel(s.eventId);

  // A phone that bootstrapped before the cancellation still believes it may
  // admit. The row is never rejected — that is the append-only rule — but
  // the server flags that it would have refused.
  const res = await scan(s, s.passId, "admitted");
  assert.equal(res.statusCode, 200);
  const [out] = res.json().results;
  assert.equal(out.accepted, true);
  assert.equal(out.contested, true);

  const [row] = await sql`
    select note from check_in_events where event_id = ${s.eventId}`;
  assert.match(row!.note, /event_cancelled/);
});

test("the gate's own refusal is storable", async () => {
  const s = await seedEvent(app);
  await cancel(s.eventId);

  // What a scanner that knows sends up. Needs the enum value to exist
  // (migration 008) — without it this fails at the insert.
  const res = await scan(s, s.passId, "event_cancelled");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().results[0].accepted, true);

  const [row] = await sql`
    select result, admitted_count, occupancy_delta
    from check_in_events where event_id = ${s.eventId}`;
  assert.equal(row!.result, "event_cancelled");
  assert.equal(row!.admitted_count, 0);
  assert.equal(row!.occupancy_delta, 0);
});

// ---- undo ----------------------------------------------------------------

test("reinstating an event restores the guest page and the gate", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);

  await cancel(s.eventId);
  await reinstate(s.eventId);

  const page = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(page.json().cancelled, false);
  // The same token still verifies: cancelling reissues nothing and moves no
  // token version, which is what makes "set it back to active" honest.
  assert.equal(page.json().pass_code, token);

  const boot = await app.inject({
    method: "GET",
    url: `/scanner/legs/${s.legId}/bootstrap`,
    headers: { authorization: `Bearer ${s.usherToken}` },
  });
  assert.equal(boot.json().event.cancelled, false);

  const rsvp = await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: s.legId, attending: true, count: 2 },
  });
  assert.equal(rsvp.statusCode, 200);
});

test("cancelling erases nothing", async () => {
  const s = await seedEvent(app);
  await scan(s, s.passId, "admitted");
  await cancel(s.eventId);

  const [events] = await sql`
    select count(*)::int as n from check_in_events where event_id = ${s.eventId}`;
  assert.equal(events!.n, 1);
  const [invs] = await sql`
    select count(*)::int as n from invitations where event_id = ${s.eventId}`;
  assert.ok(invs!.n >= 1);
});

// ---- somebody for an usher to call ---------------------------------------
//
// "Call manager" has been on every hold and refusal decide() returns since
// the scanner was built, and it dismissed without doing anything. An usher
// facing a guest they cannot admit had no way to escalate except finding
// the couple, at their own wedding.

test("the gate is told who to call, offline", async () => {
  const s = await seedEvent(app);
  await sql`update events set manager_phone = '+2348034112098'
    where id = ${s.eventId}`;

  const boot = await app.inject({
    method: "GET",
    url: `/scanner/legs/${s.legId}/bootstrap`,
    headers: { authorization: `Bearer ${s.usherToken}` },
  });
  // In the payload, not fetched on demand: the moment an usher needs this
  // is the moment the signal has gone.
  assert.equal(boot.json().event.manager_phone, "+2348034112098");
});

test("no number set means no number carried", async () => {
  const s = await seedEvent(app);
  const boot = await app.inject({
    method: "GET",
    url: `/scanner/legs/${s.legId}/bootstrap`,
    headers: { authorization: `Bearer ${s.usherToken}` },
  });
  assert.equal(boot.json().event.manager_phone, null);
});

test("the organiser sets and clears it from settings", async () => {
  const s = await seedEvent(app);
  const owner = await sql`
    select owner_user_id from workspaces w
    join events e on e.workspace_id = w.id where e.id = ${s.eventId}`;
  const token = app.jwt.sign({ sub: owner[0]!.owner_user_id });

  const set = await app.inject({
    method: "PATCH",
    url: `/events/${s.eventId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { manager_phone: "+234 803 411 2098" },
  });
  assert.equal(set.statusCode, 200);
  // Spaces and dashes are how people type a number, not how it dials.
  assert.equal(set.json().manager_phone, "+2348034112098");

  const cleared = await app.inject({
    method: "PATCH",
    url: `/events/${s.eventId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { manager_phone: "" },
  });
  assert.equal(cleared.json().manager_phone, null);
});

test("a number that cannot be dialled is refused", async () => {
  const s = await seedEvent(app);
  const owner = await sql`
    select owner_user_id from workspaces w
    join events e on e.workspace_id = w.id where e.id = ${s.eventId}`;
  const token = app.jwt.sign({ sub: owner[0]!.owner_user_id });

  const res = await app.inject({
    method: "PATCH",
    url: `/events/${s.eventId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { manager_phone: "call the planner" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "bad_manager_phone");
});

test("editing other settings leaves the number alone", async () => {
  // The coalesce rule: a form that posts three fields must not blank the
  // other five.
  const s = await seedEvent(app);
  const owner = await sql`
    select owner_user_id from workspaces w
    join events e on e.workspace_id = w.id where e.id = ${s.eventId}`;
  const token = app.jwt.sign({ sub: owner[0]!.owner_user_id });

  await app.inject({
    method: "PATCH",
    url: `/events/${s.eventId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { manager_phone: "+2348034112098" },
  });
  const other = await app.inject({
    method: "PATCH",
    url: `/events/${s.eventId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { allow_walkins: false },
  });
  assert.equal(other.json().manager_phone, "+2348034112098");
});
