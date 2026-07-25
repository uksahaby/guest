// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sql } from "./db.ts";
import { issueToken } from "checkin-core/token";

// Fixed ids so reruns upsert rather than accumulate.
const IDS = {
  user: "11111111-1111-1111-1111-111111111111",
  workspace: "11111111-1111-1111-1111-111111111112",
  event: "11111111-1111-1111-1111-111111111113",
  leg: "11111111-1111-1111-1111-111111111114",
  invitation: "11111111-1111-1111-1111-111111111115",
  pass: "11111111-1111-1111-1111-111111111116",
};

async function seed() {
  await sql`insert into users (id, phone, full_name)
    values (${IDS.user}, '+2348011111111', 'Smoke Owner')
    on conflict (id) do nothing`;
  await sql`insert into workspaces (id, name, owner_user_id)
    values (${IDS.workspace}, 'Smoke WS', ${IDS.user})
    on conflict (id) do nothing`;
  await sql`insert into events (id, workspace_id, name, signing_key, status)
    values (${IDS.event}, ${IDS.workspace}, 'Smoke Wedding', gen_random_bytes(32), 'active')
    on conflict (id) do nothing`;
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${IDS.leg}, ${IDS.event}, 'Main', 1, now() + interval '7 days')
    on conflict (id) do nothing`;
  await sql`insert into invitations (id, event_id, display_name, primary_phone)
    values (${IDS.invitation}, ${IDS.event}, 'Mr & Mrs Smoke', '+2348022222222')
    on conflict (id) do nothing`;
  await sql`insert into invitation_legs (invitation_id, leg_id, allowance)
    values (${IDS.invitation}, ${IDS.leg}, 4)
    on conflict (invitation_id, leg_id) do nothing`;
  await sql`insert into passes (id, invitation_id, event_id)
    values (${IDS.pass}, ${IDS.invitation}, ${IDS.event})
    on conflict (id) do nothing`;
}

const app = buildServer();
after(async () => {
  await app.close();
  await sql.end();
});

test("health endpoint reaches the database", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test("a token issued from db state verifies through checkin-core", async () => {
  await seed();
  const [event] = await sql`
    select signing_key, token_version from events where id = ${IDS.event}`;
  assert.ok(event);

  const raw = issueToken(
    { passId: IDS.pass, eventId: IDS.event, tokenVersion: event.token_version },
    Buffer.from(event.signing_key),
  );
  // ~62 chars keeps the QR at a low version — regression-guard it.
  assert.ok(raw.length <= 70, `token unexpectedly long: ${raw.length}`);

  const res = await app.inject({
    method: "POST",
    url: "/dev/verify-token",
    payload: { raw, event_id: IDS.event },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.payload.passId, IDS.pass);
  assert.equal(body.matched.eventName, "Smoke Wedding");
});

test("a forged token is rejected", async () => {
  const [event] = await sql`
    select signing_key, token_version from events where id = ${IDS.event}`;
  assert.ok(event);
  const raw = issueToken(
    { passId: randomUUID(), eventId: IDS.event, tokenVersion: event.token_version },
    Buffer.from("not-the-real-key-not-the-real-key"),
  );
  const res = await app.inject({
    method: "POST",
    url: "/dev/verify-token",
    payload: { raw, event_id: IDS.event },
  });
  assert.equal(res.json().ok, false);
});
