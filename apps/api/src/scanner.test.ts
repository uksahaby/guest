// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { seedEvent } from "./testutil.ts";

const app = buildServer();
after(async () => {
  await app.close();
  await closeDb();
});

function get(url: string, token: string) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
}

test("assignments lists the usher's legs with guest counts", async () => {
  const s = await seedEvent(app);
  const res = await get("/scanner/assignments", s.usherToken);
  assert.equal(res.statusCode, 200);
  const rows = res.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].leg_id, s.legId);
  assert.equal(rows[0].event_name, "Test Wedding");
  assert.equal(rows[0].guest_count, 2);
  assert.equal(rows[0].is_open, true);
});

test("bootstrap is refused without an assignment on the leg", async () => {
  const s = await seedEvent(app);
  const res = await get(`/scanner/legs/${s.legId}/bootstrap`, s.outsiderToken);
  assert.equal(res.statusCode, 403);
});

test("bootstrap returns policy, key, entrances and the leg's guest list", async () => {
  const s = await seedEvent(app);
  const res = await get(`/scanner/legs/${s.legId}/bootstrap`, s.usherToken);
  assert.equal(res.statusCode, 200);
  const b = res.json();

  assert.equal(b.event.id, s.eventId);
  assert.equal(b.event.allow_overflow, true);
  assert.equal(b.event.require_rsvp, false);

  assert.equal(b.keys.length, 1);
  assert.equal(b.keys[0].event_id, s.eventId);
  assert.equal(Buffer.from(b.keys[0].key, "base64").length, 32);
  assert.equal(b.keys[0].token_version, 1);

  assert.equal(b.entrances.length, 1);
  assert.equal(b.entrances[0].name, "Main Gate");

  assert.equal(b.invitations.length, 2);
  const adeyemi = b.invitations.find((i: { display_name: string }) =>
    i.display_name === "Mr & Mrs Adeyemi");
  assert.equal(adeyemi.pass_id, s.passId);
  assert.equal(adeyemi.allowance, 4);
  assert.equal(adeyemi.admitted, 0);
  assert.equal(adeyemi.rsvp, "pending");

  // Search terms are lowercased for local matching, and carry only the
  // LAST FOUR DIGITS of the phone — an usher can confirm a number read
  // aloud to them, but a lost device is not a leaked guest list.
  assert.ok(adeyemi.search_terms.includes("adeyemi"));
  const [phone] = await sql`
    select primary_phone from invitations where id = ${s.invitationId}`;
  const full = phone!.primary_phone.replace(/\D/g, "");
  assert.ok(
    adeyemi.search_terms.includes(full.slice(-4)),
    "last four digits should be searchable",
  );
  assert.ok(
    !adeyemi.search_terms.includes(full),
    "the full phone number must never reach a scanner device",
  );
  assert.ok(!JSON.stringify(b).includes(full));

  assert.deepEqual(b.revoked_pass_ids, []);
});

test("bootstrap carries keys for every event the usher works", async () => {
  const s1 = await seedEvent(app);
  const s2 = await seedEvent(app);
  // Same usher assigned to the second event's leg too.
  await sql`insert into staff_assignments (user_id, leg_id)
    values (${s1.usherId}, ${s2.legId})`;

  const res = await get(`/scanner/legs/${s1.legId}/bootstrap`, s1.usherToken);
  const b = res.json();
  assert.equal(b.keys.length, 2);
  const ids = b.keys.map((k: { event_id: string }) => k.event_id).sort();
  assert.deepEqual(ids, [s1.eventId, s2.eventId].sort());
});

test("bootstrap reflects admissions and revocations", async () => {
  const s = await seedEvent(app);
  // Land an admission through the real endpoint.
  await app.inject({
    method: "POST",
    url: "/scanner/check-ins",
    headers: { authorization: `Bearer ${s.usherToken}` },
    payload: {
      items: [{
        client_uuid: randomUUID(),
        leg_id: s.legId,
        pass_id: s.passId,
        result: "partial",
        admitted_count: 3,
        scanned_at: new Date().toISOString(),
      }],
    },
  });
  await sql`update passes set status = 'revoked', revoked_at = now()
    where id = ${s.soloPassId}`;

  const b = (await get(`/scanner/legs/${s.legId}/bootstrap`, s.usherToken)).json();
  const adeyemi = b.invitations.find((i: { pass_id: string }) => i.pass_id === s.passId);
  assert.equal(adeyemi.admitted, 3);
  assert.deepEqual(b.revoked_pass_ids, [s.soloPassId]);
});

test("scanner test ping records readiness", async () => {
  const s = await seedEvent(app);
  const res = await app.inject({
    method: "POST",
    url: `/scanner/legs/${s.legId}/test`,
    headers: { authorization: `Bearer ${s.usherToken}` },
  });
  assert.equal(res.statusCode, 204);
  const [row] = await sql`
    select last_tested_at from staff_assignments
    where user_id = ${s.usherId} and leg_id = ${s.legId}`;
  assert.ok(row!.last_tested_at);
});
