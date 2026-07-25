// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";

const app = buildServer();
after(async () => {
  await app.close();
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

async function request(p: string) {
  return app.inject({ method: "POST", url: "/auth/otp/request", payload: { phone: p } });
}
async function verify(p: string, code: string) {
  return app.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone: p, code } });
}

test("requesting a code returns 202 with the resend interval and a dev code", async () => {
  const res = await request(phone());
  assert.equal(res.statusCode, 202);
  const body = res.json();
  assert.equal(body.retry_after_seconds, 30);
  assert.match(body.dev_code, /^\d{6}$/);
});

test("mangled phone numbers are rejected; spaced ones are normalised", async () => {
  assert.equal((await request("08034112098")).statusCode, 400); // no +country
  assert.equal((await request("not a phone")).statusCode, 400);
  assert.equal((await request("+234 803 411 2098")).statusCode, 202);
});

test("an immediate resend is rate limited", async () => {
  const p = phone();
  await request(p);
  const res = await request(p);
  assert.equal(res.statusCode, 429);
  assert.ok(res.json().retry_after_seconds > 0);
});

test("the full journey: code → session → /me", async () => {
  const p = phone();
  const { dev_code } = (await request(p)).json();

  const res = await verify(p, dev_code);
  assert.equal(res.statusCode, 200);
  const session = res.json();
  assert.ok(session.access_token);
  assert.ok(session.refresh_token);
  assert.equal(session.expires_in, 30 * 24 * 3600);
  assert.equal(session.user.phone, p);

  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.id, session.user.id);
  assert.deepEqual(me.json().workspaces, []);
});

test("a wrong code fails, and five wrong tries kill the code entirely", async () => {
  const p = phone();
  const { dev_code } = (await request(p)).json();
  const wrong = dev_code === "000000" ? "000001" : "000000";

  for (let i = 0; i < 5; i++) {
    assert.equal((await verify(p, wrong)).statusCode, 401);
  }
  // Even the right code is dead now.
  assert.equal((await verify(p, dev_code)).statusCode, 401);
});

test("a code cannot be used twice", async () => {
  const p = phone();
  const { dev_code } = (await request(p)).json();
  assert.equal((await verify(p, dev_code)).statusCode, 200);
  assert.equal((await verify(p, dev_code)).statusCode, 401);
});

test("an expired code is refused", async () => {
  const p = phone();
  const { dev_code } = (await request(p)).json();
  await sql`update auth_otp_codes set expires_at = now() - interval '1 minute'
    where phone = ${p}`;
  assert.equal((await verify(p, dev_code)).statusCode, 401);
});

test("signing in again finds the same user", async () => {
  const p = phone();
  const a = (await request(p)).json();
  const first = (await verify(p, a.dev_code)).json();

  // Wait out the resend window by backdating the previous code.
  await sql`update auth_otp_codes set created_at = now() - interval '1 minute'
    where phone = ${p}`;
  const b = (await request(p)).json();
  const second = (await verify(p, b.dev_code)).json();

  assert.equal(first.user.id, second.user.id);
});

test("/me lists owned and member workspaces with roles", async () => {
  const p = phone();
  const { dev_code } = (await request(p)).json();
  const session = (await verify(p, dev_code)).json();
  const userId = session.user.id;

  const owned = randomUUID(), otherOwner = randomUUID(), memberWs = randomUUID();
  await sql`insert into workspaces (id, name, owner_user_id, is_implicit)
    values (${owned}, 'Mine', ${userId}, true)`;
  await sql`insert into users (id, phone, full_name) values (${otherOwner}, ${phone()}, 'Planner')`;
  await sql`insert into workspaces (id, name, owner_user_id, is_implicit)
    values (${memberWs}, 'Client WS', ${otherOwner}, false)`;
  await sql`insert into workspace_memberships (workspace_id, user_id, role)
    values (${memberWs}, ${userId}, 'event_manager')`;

  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  const ws = me.json().workspaces;
  assert.equal(ws.length, 2);
  assert.equal(ws.find((w: { id: string }) => w.id === owned).role, "owner");
  assert.equal(ws.find((w: { id: string }) => w.id === memberWs).role, "event_manager");
});
