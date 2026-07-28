// The two ways in that are not an SMS.
//
// Both exist because a deployed system was unreachable until someone had
// funded a Termii account, and because SMS delivery in Nigeria fails often
// enough that an usher in a hotel basement at 6pm is a real failure mode.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { hashPassword, verifyPassword, passwordProblem } from "./credentials.ts";

const app = buildServer();
before(() => app.ready());
after(async () => {
  await app.close();
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

/** An organiser with an event, a leg, and one usher on it. */
async function withUsher() {
  const owner = randomUUID();
  const usher = randomUUID();
  const ws = randomUUID();
  const event = randomUUID();
  const leg = randomUUID();

  await sql`insert into users (id, phone, full_name) values
    (${owner}, ${phone()}, 'Owner'), (${usher}, ${phone()}, 'Usher Musa')`;
  await sql`insert into workspaces (id, name, owner_user_id) values (${ws}, 'WS', ${owner})`;
  await sql`insert into events (id, workspace_id, name, signing_key)
    values (${event}, ${ws}, 'Test Wedding', gen_random_bytes(32))`;
  await sql`insert into event_legs (id, event_id, name, starts_at, sequence)
    values (${leg}, ${event}, 'Reception', now() + interval '1 day', 1)`;
  const [sa] = await sql`insert into staff_assignments (user_id, leg_id)
    values (${usher}, ${leg}) returning id`;

  return {
    ownerToken: app.jwt.sign({ sub: owner }),
    ownerId: owner,
    usherId: usher,
    legId: leg,
    staffId: sa!.id as string,
  };
}

const invite = (staffId: string, token: string) =>
  app.inject({
    method: "POST",
    url: `/staff/${staffId}/invite`,
    headers: { authorization: `Bearer ${token}` },
  });

const accept = (raw: string) =>
  app.inject({ method: "POST", url: `/public/staff-invites/${raw}/accept` });

/** The token out of the returned URL. */
const tokenFrom = (url: string) => url.split("/join/")[1]!;

// ---- invite links --------------------------------------------------------

test("an usher signs in by tapping a link, with no SMS at all", async () => {
  const s = await withUsher();
  const issued = await invite(s.staffId, s.ownerToken);
  assert.equal(issued.statusCode, 201);
  assert.match(issued.json().url, /\/join\//);

  const res = await accept(tokenFrom(issued.json().url));
  assert.equal(res.statusCode, 200);
  const session = res.json();
  assert.equal(session.user.id, s.usherId);
  assert.ok(session.access_token);
  // So the web can drop them straight on the gate they were invited to.
  assert.equal(session.leg_id, s.legId);

  // And that session really works.
  const me = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  assert.equal(me.statusCode, 200);
});

test("a link is spent once — a forwarded copy is worthless", async () => {
  const s = await withUsher();
  const raw = tokenFrom((await invite(s.staffId, s.ownerToken)).json().url);

  assert.equal((await accept(raw)).statusCode, 200);
  assert.equal((await accept(raw)).statusCode, 404, "second use must fail");
});

test("issuing a new link kills the old one", async () => {
  // How an organiser takes back a link sent to the wrong number.
  const s = await withUsher();
  const first = tokenFrom((await invite(s.staffId, s.ownerToken)).json().url);
  const second = tokenFrom((await invite(s.staffId, s.ownerToken)).json().url);

  assert.equal((await accept(first)).statusCode, 404);
  assert.equal((await accept(second)).statusCode, 200);
});

test("an expired link is refused", async () => {
  const s = await withUsher();
  const raw = tokenFrom((await invite(s.staffId, s.ownerToken)).json().url);
  await sql`update staff_invites set expires_at = now() - interval '1 minute'`;
  assert.equal((await accept(raw)).statusCode, 404);
});

test("garbage and forged links read exactly like a spent one", async () => {
  // Otherwise the endpoint tells an attacker which links exist.
  const s = await withUsher();
  const real = tokenFrom((await invite(s.staffId, s.ownerToken)).json().url);

  const short = await accept("nope");
  const forged = await accept(real.slice(0, -6) + "AAAAAA");
  assert.equal(short.statusCode, 404);
  assert.equal(forged.statusCode, 404);
  assert.equal(short.json().code, forged.json().code);
});

test("the raw link is never stored, only its hash", async () => {
  const s = await withUsher();
  const url = (await invite(s.staffId, s.ownerToken)).json().url;
  const raw = tokenFrom(url);

  const [row] = await sql`select token_hash from staff_invites`;
  assert.notEqual(row!.token_hash, raw);
  assert.ok(!row!.token_hash.includes(raw), "a database read must not yield a working link");
});

test("only someone who manages the leg can issue one", async () => {
  const s = await withUsher();
  const stranger = randomUUID();
  await sql`insert into users (id, phone, full_name)
    values (${stranger}, ${phone()}, 'Nosy')`;

  const res = await invite(s.staffId, app.jwt.sign({ sub: stranger }));
  assert.equal(res.statusCode, 403);
});

test("issuing a link needs a session", async () => {
  const s = await withUsher();
  const res = await app.inject({ method: "POST", url: `/staff/${s.staffId}/invite` });
  assert.equal(res.statusCode, 401);
});

// ---- organiser passwords -------------------------------------------------

test("an organiser sets a password and signs in with it", async () => {
  const s = await withUsher();

  const set = await app.inject({
    method: "POST",
    url: "/auth/password",
    headers: { authorization: `Bearer ${s.ownerToken}` },
    payload: { password: "a-long-enough-one" },
  });
  assert.equal(set.statusCode, 204);

  const [u] = await sql`select phone, password_hash from users where id = ${s.ownerId}`;
  assert.ok(u!.password_hash, "stored");
  assert.ok(!u!.password_hash.includes("a-long-enough-one"), "never in clear");

  const login = await app.inject({
    method: "POST",
    url: "/auth/password/login",
    payload: { phone: u!.phone, password: "a-long-enough-one" },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().user.id, s.ownerId);
});

test("a wrong password, an unknown number and a password-less account all fail alike", async () => {
  const s = await withUsher();
  await app.inject({
    method: "POST",
    url: "/auth/password",
    headers: { authorization: `Bearer ${s.ownerToken}` },
    payload: { password: "a-long-enough-one" },
  });
  const [u] = await sql`select phone from users where id = ${s.ownerId}`;

  const wrong = await app.inject({
    method: "POST",
    url: "/auth/password/login",
    payload: { phone: u!.phone, password: "not-the-password" },
  });
  const unknown = await app.inject({
    method: "POST",
    url: "/auth/password/login",
    payload: { phone: phone(), password: "a-long-enough-one" },
  });
  // An usher who never set one.
  const [usherPhone] = await sql`select phone from users where id = ${s.usherId}`;
  const noPassword = await app.inject({
    method: "POST",
    url: "/auth/password/login",
    payload: { phone: usherPhone!.phone, password: "a-long-enough-one" },
  });

  for (const r of [wrong, unknown, noPassword]) {
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, "invalid_login");
  }
});

test("short passwords are refused, and only your own can be set", async () => {
  const s = await withUsher();
  const short = await app.inject({
    method: "POST",
    url: "/auth/password",
    headers: { authorization: `Bearer ${s.ownerToken}` },
    payload: { password: "short" },
  });
  assert.equal(short.statusCode, 400);

  // There is no route that sets someone else's password at all — an
  // organiser knowing an usher's credential is the thing invite links
  // exist to avoid.
  const anon = await app.inject({
    method: "POST",
    url: "/auth/password",
    payload: { password: "a-long-enough-one" },
  });
  assert.equal(anon.statusCode, 401);
});

test("OTP still works for an account with a password", async () => {
  // The recovery path. A password with no way back in is a support problem.
  const s = await withUsher();
  await app.inject({
    method: "POST",
    url: "/auth/password",
    headers: { authorization: `Bearer ${s.ownerToken}` },
    payload: { password: "a-long-enough-one" },
  });
  const [u] = await sql`select phone from users where id = ${s.ownerId}`;

  const req = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    payload: { phone: u!.phone },
  });
  assert.equal(req.statusCode, 202);
  const verified = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    payload: { phone: u!.phone, code: req.json().dev_code },
  });
  assert.equal(verified.statusCode, 200);
});

// ---- the hashing itself --------------------------------------------------

test("scrypt round-trips, and salts so two identical passwords differ", async () => {
  const a = await hashPassword("the-same-password");
  const b = await hashPassword("the-same-password");
  assert.notEqual(a, b, "unsalted hashes make a stolen table a password list");
  assert.ok(await verifyPassword("the-same-password", a));
  assert.ok(await verifyPassword("the-same-password", b));
  assert.ok(!(await verifyPassword("the-same-password ", a)));
});

test("a malformed or missing hash verifies false rather than throwing", async () => {
  assert.ok(!(await verifyPassword("anything", null)));
  assert.ok(!(await verifyPassword("anything", "")));
  assert.ok(!(await verifyPassword("anything", "not$a$real$hash")));
});

test("length is the only rule", async () => {
  assert.equal(passwordProblem("0123456789"), null);
  assert.ok(passwordProblem("012345678"));
  assert.ok(passwordProblem(""));
  assert.ok(passwordProblem(undefined));
  assert.ok(passwordProblem("x".repeat(201)));
});
