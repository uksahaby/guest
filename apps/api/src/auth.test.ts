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

test("a phone number is read the way it is written", async () => {
  // Used to demand E.164 and reject the local form outright. The guest
  // importer has always accepted these — and it turns them into WhatsApp
  // messages to real people — so refusing them at the door was the odd
  // one out, and it surfaced as "wrong password" (phone.ts).
  assert.equal((await request("08034112098")).statusCode, 202);
  assert.equal((await request("+234 803 411 2099")).statusCode, 202);
  assert.equal((await request("2348034112097")).statusCode, 202);

  // Still not a phone number.
  assert.equal((await request("not a phone")).statusCode, 400);
  assert.equal((await request("0803")).statusCode, 400);
});

test("the local and international forms are one account, not two", async () => {
  // The whole point: 0803… and +234803… must resolve to the same row, or
  // an organiser signs up one way and cannot sign in the other.
  const local = "08039990001";
  const e164 = "+2348039990001";

  const signup = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { phone: local, password: "correct horse battery", full_name: "Ada" },
  });
  assert.equal(signup.statusCode, 201);
  assert.equal(signup.json().user.phone, e164, "stored in E.164 whatever was typed");

  // The same number in international form is now taken, not free.
  const again = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { phone: e164, password: "another good one", full_name: "Ada" },
  });
  assert.equal(again.statusCode, 409);

  // And signing in works from either form.
  for (const p of [local, e164, "234 803 999 0001"]) {
    const res = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      payload: { phone: p, password: "correct horse battery" },
    });
    assert.equal(res.statusCode, 200, `could not sign in with ${p}`);
  }
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

// ---- naming yourself -----------------------------------------------------
//
// Sign-in is phone-only, so PATCH /me is the only thing that can ever give
// a user a name.

async function signedIn() {
  const p = phone();
  const { dev_code } = (await request(p)).json();
  const session = (await verify(p, dev_code)).json();
  return { phone: p, ...session } as {
    phone: string;
    access_token: string;
    user: { id: string; full_name: string };
  };
}

function patchMe(token: string, body: unknown) {
  return app.inject({
    method: "PATCH",
    url: "/me",
    headers: { authorization: `Bearer ${token}` },
    payload: body as Record<string, unknown>,
  });
}

test("a new user has no name until they give one", async () => {
  const s = await signedIn();
  assert.equal(s.user.full_name, "");

  const res = await patchMe(s.access_token, { full_name: "Ahmed Bello" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.full_name, "Ahmed Bello");

  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${s.access_token}` },
  });
  assert.equal(me.json().user.full_name, "Ahmed Bello");
});

test("a name is trimmed, and an empty one is refused", async () => {
  const s = await signedIn();
  assert.equal((await patchMe(s.access_token, { full_name: "   " })).statusCode, 400);
  assert.equal((await patchMe(s.access_token, { full_name: "" })).statusCode, 400);

  const res = await patchMe(s.access_token, { full_name: "  Aisha Bello  " });
  assert.equal(res.json().user.full_name, "Aisha Bello");
});

test("email is optional, validated, and independent of the name", async () => {
  const s = await signedIn();
  await patchMe(s.access_token, { full_name: "Chidi Okafor" });

  assert.equal((await patchMe(s.access_token, { email: "nope" })).statusCode, 400);

  const res = await patchMe(s.access_token, { email: "chidi@example.com" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.email, "chidi@example.com");
  // Sending only an email must not blank the name.
  assert.equal(res.json().user.full_name, "Chidi Okafor");
});

test("naming yourself before the first event names the workspace", async () => {
  // events.ts builds the implicit workspace from full_name, falling back to
  // "My events" — so the order matters, and this is why onboarding asks
  // before the dashboard.
  const s = await signedIn();
  await patchMe(s.access_token, { full_name: "Folake Adeyemi" });

  const created = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${s.access_token}` },
    payload: {
      name: "Folake & Tunde",
      leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
    },
  });
  assert.equal(created.statusCode, 201);

  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${s.access_token}` },
  });
  assert.equal(me.json().workspaces[0].name, "Folake Adeyemi");
});

test("an unnamed user still gets a usable workspace, not a blank one", async () => {
  const s = await signedIn();
  const created = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${s.access_token}` },
    payload: {
      name: "Someone & Someone",
      leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
    },
  });
  assert.equal(created.statusCode, 201);

  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${s.access_token}` },
  });
  assert.equal(me.json().workspaces[0].name, "My events");
});

test("PATCH /me needs a session", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: "/me",
    payload: { full_name: "Nobody" },
  });
  assert.equal(res.statusCode, 401);
});
