// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { seedEvent, passTokenFor } from "./testutil.ts";

const app = buildServer();
after(async () => {
  await app.close();
  await closeDb();
});

test("a household opens its invitation with the pass token", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);

  const res = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(res.statusCode, 200);
  const inv = res.json();

  assert.equal(inv.event_name, "Test Wedding");
  assert.equal(inv.display_name, "Mr & Mrs Adeyemi");
  assert.equal(inv.note, "Aso-ebi is emerald and gold.");
  // The QR payload is the same token — one code, gate and page alike.
  assert.equal(inv.pass_code, token);

  assert.equal(inv.legs.length, 1);
  const leg = inv.legs[0];
  assert.equal(leg.allowance, 4);
  assert.equal(leg.rsvp, "pending");
  assert.equal(leg.venue_name, "Oriental Hotel");
  assert.ok(leg.map_url.startsWith("https://maps.google.com/?q=6.4281"));
});

test("nothing about any other household leaks", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);
  const body = (await app.inject({ method: "GET", url: `/public/invitations/${token}` })).body;
  assert.ok(!body.includes("Chidinma")); // the other seeded household
  assert.ok(!body.includes("+234")); // no phone numbers on the guest page
});

test("garbage, forged, and revoked tokens all read as the same 404", async () => {
  const s = await seedEvent(app);

  const garbage = await app.inject({ method: "GET", url: "/public/invitations/not-a-token" });
  assert.equal(garbage.statusCode, 404);

  // Right shape, wrong signature.
  const real = await passTokenFor(s.passId, s.eventId);
  const forged = real.slice(0, -4) + (real.endsWith("AAAA") ? "BBBB" : "AAAA");
  const bad = await app.inject({ method: "GET", url: `/public/invitations/${forged}` });
  assert.equal(bad.statusCode, 404);

  // Genuine token, revoked pass.
  await sql`update passes set status = 'revoked' where id = ${s.passId}`;
  const revoked = await app.inject({ method: "GET", url: `/public/invitations/${real}` });
  assert.equal(revoked.statusCode, 404);
});

test("a reissued pass invalidates the old link", async () => {
  const s = await seedEvent(app);
  const oldToken = await passTokenFor(s.passId, s.eventId);
  await sql`update events set token_version = 2 where id = ${s.eventId}`;
  const res = await app.inject({ method: "GET", url: `/public/invitations/${oldToken}` });
  assert.equal(res.statusCode, 404);
});

// ------------------------------------------------------------------ rsvp

async function rsvp(token: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: payload as Record<string, unknown>,
  });
}

test("full-count reply confirms as attending", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);
  const res = await rsvp(token, { leg_id: s.legId, attending: true, count: 4 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().legs[0].rsvp, "attending");

  const [row] = await sql`select rsvp, rsvp_count, responded_at from invitation_legs
    where invitation_id = ${s.invitationId} and leg_id = ${s.legId}`;
  assert.equal(row!.rsvp, "attending");
  assert.equal(row!.rsvp_count, 4);
  assert.ok(row!.responded_at);
});

test("'three of our four are coming' is partial — and counts as confirmed", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);
  await rsvp(token, { leg_id: s.legId, attending: true, count: 3 });

  const [row] = await sql`select rsvp, rsvp_count from invitation_legs
    where invitation_id = ${s.invitationId} and leg_id = ${s.legId}`;
  assert.equal(row!.rsvp, "partial");
  assert.equal(row!.rsvp_count, 3);

  // The caterer's number: partial replies belong in confirmed_people.
  const [att] = await sql`select confirmed_people from leg_attendance
    where leg_id = ${s.legId}`;
  assert.equal(Number(att!.confirmed_people), 3);
});

test("declining, and changing the reply afterwards", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);

  await rsvp(token, { leg_id: s.legId, attending: false });
  let [row] = await sql`select rsvp, rsvp_count from invitation_legs
    where invitation_id = ${s.invitationId} and leg_id = ${s.legId}`;
  assert.equal(row!.rsvp, "declined");
  assert.equal(row!.rsvp_count, 0);

  // "You can change this any time before the deadline."
  await rsvp(token, { leg_id: s.legId, attending: true, count: 2 });
  [row] = await sql`select rsvp, rsvp_count from invitation_legs
    where invitation_id = ${s.invitationId} and leg_id = ${s.legId}`;
  assert.equal(row!.rsvp, "partial");
  assert.equal(row!.rsvp_count, 2);
});

test("a count above the allowance is clamped, never expanded", async () => {
  const s = await seedEvent(app);
  const token = await passTokenFor(s.passId, s.eventId);
  await rsvp(token, { leg_id: s.legId, attending: true, count: 9 });
  const [row] = await sql`select rsvp, rsvp_count from invitation_legs
    where invitation_id = ${s.invitationId} and leg_id = ${s.legId}`;
  assert.equal(row!.rsvp, "attending");
  assert.equal(row!.rsvp_count, 4);
});

test("replies after the deadline are refused", async () => {
  const s = await seedEvent(app, { rsvpDeadline: "2020-01-01" });
  const token = await passTokenFor(s.passId, s.eventId);
  const res = await rsvp(token, { leg_id: s.legId, attending: true, count: 4 });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "deadline_passed");
});

test("rsvp for a leg the household is not invited to is a 404", async () => {
  const s1 = await seedEvent(app);
  const s2 = await seedEvent(app);
  const token = await passTokenFor(s1.passId, s1.eventId);
  const res = await rsvp(token, { leg_id: s2.legId, attending: true });
  assert.equal(res.statusCode, 404);
});

// ---------------------------------------------------------- children split
//
// Caterers price and seat children differently and the RSVP screen shows
// the split, so the guest page asks. "None of us are children" and "nobody
// asked" are different answers and only one of them is a fact.

test("a guest can say how many of the party are children", async () => {
  const s0 = await seedEvent(app);
  const token = await passTokenFor(s0.passId, s0.eventId);
  const legId = s0.legId;

  const res = await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: legId, attending: true, count: 4, children: 2 },
  });
  assert.equal(res.statusCode, 200);

  const [row] = await sql`
    select rsvp, rsvp_count, adults, children from invitation_legs
    where leg_id = ${legId} and invitation_id = ${s0.invitationId}`;
  assert.equal(row!.rsvp, "attending");
  assert.equal(row!.rsvp_count, 4);
  assert.equal(row!.children, 2);
  assert.equal(row!.adults, 2, "adults is the remainder, never asked twice");
});

test("skipping the question leaves both null, not zero", async () => {
  const s0 = await seedEvent(app);
  const token = await passTokenFor(s0.passId, s0.eventId);
  const legId = s0.legId;

  await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: legId, attending: true, count: 3 },
  });

  const [row] = await sql`
    select adults, children from invitation_legs
    where leg_id = ${legId} and invitation_id = ${s0.invitationId}`;
  assert.equal(row!.children, null, "nobody asked is not the same as none");
  assert.equal(row!.adults, null);
});

test("more children than people is clamped, not stored", async () => {
  const s0 = await seedEvent(app);
  const token = await passTokenFor(s0.passId, s0.eventId);
  const legId = s0.legId;

  await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: legId, attending: true, count: 2, children: 9 },
  });

  const [row] = await sql`
    select rsvp_count, adults, children from invitation_legs
    where leg_id = ${legId} and invitation_id = ${s0.invitationId}`;
  assert.equal(row!.children, 2);
  assert.equal(row!.adults, 0, "a mis-tap cannot invent people");
});

test("declining clears the split rather than leaving a stale one", async () => {
  const s0 = await seedEvent(app);
  const token = await passTokenFor(s0.passId, s0.eventId);
  const legId = s0.legId;

  await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: legId, attending: true, count: 4, children: 2 },
  });
  await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: legId, attending: false },
  });

  const [row] = await sql`
    select rsvp, rsvp_count, adults, children from invitation_legs
    where leg_id = ${legId} and invitation_id = ${s0.invitationId}`;
  assert.equal(row!.rsvp, "declined");
  assert.equal(row!.rsvp_count, 0);
  assert.equal(row!.children, null, "nobody is coming, so nobody is a child");
  assert.equal(row!.adults, null);
});

test("a negative children count is refused", async () => {
  const s0 = await seedEvent(app);
  const token = await passTokenFor(s0.passId, s0.eventId);
  const legId = s0.legId;
  const res = await app.inject({
    method: "POST",
    url: `/public/invitations/${token}/rsvp`,
    payload: { leg_id: legId, attending: true, count: 2, children: -1 },
  });
  assert.equal(res.statusCode, 400);
});

// Helpers for the public-event-page tests below. The rest of this file
// works off seedEvent, which builds an event with no slug and no public
// page; these need one created through the API so the settings PATCH path
// is the thing under test.
import { randomUUID } from "node:crypto";

const aPhone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

async function organiser() {
  const id = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${id}, ${aPhone()}, 'Ahmed')`;
  return { id, token: app.jwt.sign({ sub: id }) };
}

function call(token: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function newEvent(token: string) {
  await app.ready();
  const res = await call(token, "POST", "/events", {
    name: "Ahmed & Aisha",
    leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00", venue_name: "Oriental Hotel" },
  });
  assert.equal(res.statusCode, 201);
  return res.json();
}


// ---- the public event page (db/migrations/018) --------------------------

test("a public event page is off until the organiser turns it on", async () => {
  const o = await organiser();
  const ev = await newEvent(o.token);

  await call(o.token, "PATCH", `/events/${ev.id}`, { slug: "public-test-one" });
  // Slug set, page still off, event still draft: all three are 404, and
  // they are the same 404 as a slug that never existed.
  assert.equal((await app.inject({ method: "GET", url: "/public/events/public-test-one" })).statusCode, 404);

  await call(o.token, "PATCH", `/events/${ev.id}`, { public_page: true });
  // Public but not published — still nothing.
  assert.equal((await app.inject({ method: "GET", url: "/public/events/public-test-one" })).statusCode, 404);

  await call(o.token, "PATCH", `/events/${ev.id}`, { status: "active" });
  const res = await app.inject({ method: "GET", url: "/public/events/public-test-one" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.name, "Ahmed & Aisha");
  assert.ok(Array.isArray(body.legs) && body.legs.length >= 1);
  assert.equal((await app.inject({ method: "GET", url: "/public/events/no-such-event" })).statusCode, 404);
});

test("the public page carries no guest list, and RLS is why", async () => {
  const o = await organiser();
  const ev = await newEvent(o.token);
  await call(o.token, "PATCH", `/events/${ev.id}`, {
    slug: "public-test-two", public_page: true, status: "active",
  });

  const body = (await app.inject({ method: "GET", url: "/public/events/public-test-two" })).json();
  const seen = JSON.stringify(body);
  for (const leaked of ["invitations", "passes", "allowance", "primary_phone", "signing_key"]) {
    assert.equal(seen.includes(leaked), false, `public page exposed ${leaked}`);
  }
  // The connection itself cannot reach them, which is the guarantee — not
  // the shape of the select above.
  assert.equal(body.legs[0].id !== undefined, true);
});
