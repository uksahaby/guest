// Throttling the doors anyone on the internet can knock on.
//
// The endpoint tests below drive the limiter through app.limits rather
// than by sending the full quota of requests: proving the 601st public
// read is refused is worth having, and sending 600 real ones to find out
// would add a minute to the suite to test arithmetic that is already
// covered by the unit tests at the top of this file.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.ts";
import { closeDb } from "./db.ts";
import { Window } from "./ratelimit.ts";
import { parseTrustProxy } from "./env.ts";

const app = buildServer();
before(() => app.ready());
after(async () => {
  await app.close();
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

// ---- the window itself ----------------------------------------------------

test("a window allows exactly its limit, then refuses", () => {
  const w = new Window({ limit: 3, windowMs: 1000 });
  assert.equal(w.hit("a").ok, true);
  assert.equal(w.hit("a").ok, true);
  assert.equal(w.hit("a").ok, true);
  assert.equal(w.hit("a").ok, false);
});

test("keys do not see each other", () => {
  const w = new Window({ limit: 1, windowMs: 1000 });
  assert.equal(w.hit("a").ok, true);
  assert.equal(w.hit("b").ok, true);
  assert.equal(w.hit("a").ok, false);
});

test("peek reports without counting", () => {
  const w = new Window({ limit: 2, windowMs: 1000 });
  for (let i = 0; i < 20; i++) assert.equal(w.peek("a").ok, true);
  w.bump("a");
  w.bump("a");
  assert.equal(w.peek("a").ok, false);
});

test("the window expires, and retry_after counts down to it", () => {
  const w = new Window({ limit: 1, windowMs: 60_000 });
  const t0 = 1_000_000;
  w.bump("a", t0);

  const early = w.peek("a", t0 + 10_000);
  assert.equal(early.ok, false);
  assert.equal(early.ok === false && early.retryAfterSeconds, 50);

  assert.equal(w.peek("a", t0 + 59_999).ok, false);
  // Expired: the key is as good as new.
  assert.equal(w.peek("a", t0 + 60_000).ok, true);
});

test("forget clears a key — this is what a successful sign-in does", () => {
  const w = new Window({ limit: 2, windowMs: 60_000 });
  w.bump("a");
  w.bump("a");
  assert.equal(w.peek("a").ok, false);
  w.forget("a");
  assert.equal(w.peek("a").ok, true);
});

// ---- who is allowed to tell us the caller's address -----------------------

test("TRUST_PROXY parses to what Fastify expects", () => {
  // Unset must be false, or an unconfigured deploy silently trusts a
  // header anyone can forge.
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("2"), 2);
  assert.deepEqual(parseTrustProxy("10.0.0.0/8, 172.16.0.1"), [
    "10.0.0.0/8",
    "172.16.0.1",
  ]);
});

// ---- the endpoints --------------------------------------------------------

const login = (p: string, password: string) =>
  app.inject({
    method: "POST",
    url: "/auth/password/login",
    payload: { phone: p, password },
  });

const signup = (p: string) =>
  app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: { phone: p, password: "correct horse battery", full_name: "Ada" },
  });

test("a phone is locked out after ten wrong passwords, and told for how long", async () => {
  app.limits.loginFailPerPhone.clear();
  app.limits.loginPerIp.clear();
  const p = phone();
  assert.equal((await signup(p)).statusCode, 201);

  for (let i = 0; i < 10; i++) {
    assert.equal((await login(p, "wrong")).statusCode, 401, `attempt ${i + 1}`);
  }

  const res = await login(p, "wrong");
  assert.equal(res.statusCode, 429);
  const body = res.json();
  assert.equal(body.code, "rate_limited");
  assert.ok(body.retry_after_seconds > 0 && body.retry_after_seconds <= 15 * 60);
  assert.equal(res.headers["retry-after"], String(body.retry_after_seconds));
});

test("the lockout holds even against the right password", async () => {
  app.limits.loginFailPerPhone.clear();
  app.limits.loginPerIp.clear();
  const p = phone();
  await signup(p);
  for (let i = 0; i < 10; i++) await login(p, "wrong");

  // The point of counting per phone: knowing the password does not lift
  // the lockout, because a guesser who has just found it would be the one
  // asking.
  assert.equal((await login(p, "correct horse battery")).statusCode, 429);
});

test("signing in successfully clears the failures behind it", async () => {
  app.limits.loginFailPerPhone.clear();
  app.limits.loginPerIp.clear();
  const p = phone();
  await signup(p);

  for (let i = 0; i < 9; i++) await login(p, "wrong");
  assert.equal((await login(p, "correct horse battery")).statusCode, 200);

  // Nine fumbles then a success must not leave one attempt in the bank.
  for (let i = 0; i < 10; i++) {
    assert.equal((await login(p, "wrong")).statusCode, 401, `attempt ${i + 1}`);
  }
  assert.equal((await login(p, "wrong")).statusCode, 429);
});

test("one locked-out number does not lock out anybody else", async () => {
  app.limits.loginFailPerPhone.clear();
  app.limits.loginPerIp.clear();
  const victim = phone();
  const bystander = phone();
  await signup(victim);
  await signup(bystander);

  for (let i = 0; i < 11; i++) await login(victim, "wrong");
  assert.equal((await login(victim, "wrong")).statusCode, 429);

  // Same IP — which in Nigeria may be a whole carrier's worth of people.
  assert.equal((await login(bystander, "correct horse battery")).statusCode, 200);
});

test("an IP that has burned its login budget is refused whatever number it names", async () => {
  app.limits.loginFailPerPhone.clear();
  app.limits.loginPerIp.clear();
  const p = phone();
  await signup(p);

  const ip = app.limits.loginPerIp;
  for (let i = 0; i < ip.limit; i++) ip.bump("127.0.0.1");

  const res = await login(p, "correct horse battery");
  assert.equal(res.statusCode, 429);
  app.limits.loginPerIp.clear();
});

test("signup has a ceiling per address", async () => {
  app.limits.signupPerIp.clear();
  const w = app.limits.signupPerIp;
  for (let i = 0; i < w.limit; i++) w.bump("127.0.0.1");

  const res = await signup(phone());
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().code, "rate_limited");
  app.limits.signupPerIp.clear();
});

test("recovery is tighter than login, and a wrong code counts", async () => {
  app.limits.recoveryFailPerPhone.clear();
  app.limits.recoveryPerIp.clear();
  const p = phone();
  await signup(p);

  const reset = () =>
    app.inject({
      method: "POST",
      url: "/auth/recovery/reset",
      payload: { phone: p, recovery_code: "AAAA-BBBB-CCCC", password: "another good one" },
    });

  for (let i = 0; i < 5; i++) {
    assert.equal((await reset()).statusCode, 401, `attempt ${i + 1}`);
  }
  assert.equal((await reset()).statusCode, 429);

  app.limits.recoveryFailPerPhone.clear();
  app.limits.recoveryPerIp.clear();
});

test("the OTP request ceiling is per address, not just the 30-second window", async () => {
  app.limits.otpRequestPerIp.clear();
  const w = app.limits.otpRequestPerIp;
  for (let i = 0; i < w.limit; i++) w.bump("127.0.0.1");

  // A fresh number every time, so the existing per-phone resend window is
  // not what refuses this.
  const res = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    payload: { phone: phone() },
  });
  assert.equal(res.statusCode, 429);
  app.limits.otpRequestPerIp.clear();
});

test("the guest surface has a ceiling too, and a refusal is not a 404", async () => {
  app.limits.publicPerIp.clear();
  const w = app.limits.publicPerIp;
  for (let i = 0; i < w.limit; i++) w.bump("127.0.0.1");

  // A garbage token would normally be an indistinguishable 404. Over the
  // ceiling it never reaches the token check at all.
  const res = await app.inject({
    method: "GET",
    url: "/public/invitations/not-a-real-token-at-all",
  });
  assert.equal(res.statusCode, 429);
  app.limits.publicPerIp.clear();
});

test("throttling the guest surface does not throttle the gate", async () => {
  const w = app.limits.publicPerIp;
  for (let i = 0; i < w.limit + 5; i++) w.bump("127.0.0.1");

  // The hook is encapsulated in publicRoutes. An usher scanning fast is
  // the system working, and nothing at the gate is ever refused for
  // volume — so this must be the ordinary 401, not a 429.
  const res = await app.inject({ method: "GET", url: "/scanner/assignments" });
  assert.equal(res.statusCode, 401);
  app.limits.publicPerIp.clear();
});
