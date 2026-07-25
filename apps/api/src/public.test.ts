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
