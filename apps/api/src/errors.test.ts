// Knowing something broke.
//
// A log nobody is watching is not monitoring. On a wedding morning the
// organiser finds out before we do, so these cover the three things that
// have to hold: the guest gets an id and never the cause, the same fault
// repeating cannot bury everything else, and nothing phone-shaped leaves
// the building in an alert.
import "./testdb.ts";

import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import {
  Alerts,
  fingerprint,
  installErrorHandling,
  crashHandler,
  scrub,
  WebhookAlerter,
  type Alert,
  type Alerter,
} from "./errors.ts";

class FakeAlerter implements Alerter {
  readonly sent: Alert[] = [];
  async send(alert: Alert): Promise<void> {
    this.sent.push(alert);
  }
}

/** A bare server with one route that throws whatever it is handed. */
function serverThatThrows(alerts: Alerts, err: Error = new Error("boom")) {
  const app = Fastify({ logger: false });
  installErrorHandling(app, alerts);
  app.get("/explode", async () => {
    throw err;
  });
  app.get("/bad", async () => {
    const e = new Error("you sent nonsense") as Error & { statusCode: number };
    e.statusCode = 400;
    throw e;
  });
  return app;
}

test("a 500 gives the caller an id and nothing else", async () => {
  const fake = new FakeAlerter();
  const app = serverThatThrows(new Alerts(fake));

  const res = await app.inject({ method: "GET", url: "/explode" });
  assert.equal(res.statusCode, 500);

  const body = res.json();
  assert.equal(body.code, "internal_error");
  assert.ok(body.request_id, "an id the guest can read down the phone");

  // The cause is what an attacker wants and what a guest cannot use.
  const raw = res.body;
  assert.ok(!raw.includes("boom"), "the message must not leave the server");
  assert.ok(!raw.includes("at "), "no stack frames");
});

test("a 4xx is not an incident and keeps its own message", async () => {
  const fake = new FakeAlerter();
  const app = serverThatThrows(new Alerts(fake));

  const res = await app.inject({ method: "GET", url: "/bad" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().message, "you sent nonsense");
  assert.equal(fake.sent.length, 0, "nobody is woken for a bad request");
});

test("a 500 alerts once with the route, not the id in the URL", async () => {
  const fake = new FakeAlerter();
  const app = serverThatThrows(new Alerts(fake));

  await app.inject({ method: "GET", url: "/explode" });

  assert.equal(fake.sent.length, 1);
  const [sent] = fake.sent;
  assert.equal(sent!.kind, "http_500");
  assert.match(sent!.where!, /GET \/explode/);
  assert.ok(sent!.requestId);
});

test("the same fault repeating does not bury everything else", async () => {
  const fake = new FakeAlerter();
  const app = serverThatThrows(new Alerts(fake));

  for (let i = 0; i < 10; i++) {
    await app.inject({ method: "GET", url: "/explode" });
  }

  // Three per fingerprint per window: enough to notice a pattern, not
  // enough for a crash loop to become our own outbound flood.
  assert.equal(fake.sent.length, 3);
});

test("two different faults are counted apart", async () => {
  const fake = new FakeAlerter();
  const alerts = new Alerts(fake);

  const a = serverThatThrows(alerts, new TypeError("one"));
  const b = serverThatThrows(alerts, new RangeError("two"));

  for (let i = 0; i < 5; i++) await a.inject({ method: "GET", url: "/explode" });
  for (let i = 0; i < 5; i++) await b.inject({ method: "GET", url: "/explode" });

  assert.equal(fake.sent.length, 6, "three each, not three between them");
});

test("with no webhook configured, nothing is sent and nothing throws", async () => {
  const app = serverThatThrows(new Alerts(null));
  const res = await app.inject({ method: "GET", url: "/explode" });
  assert.equal(res.statusCode, 500, "the response is unaffected");
});

// ---- scrubbing -----------------------------------------------------------
//
// The logger redacts by field name, which cannot help when the number is
// inside a message. Postgres quotes the colliding value in a unique
// violation, and here that value is often somebody's phone number — and an
// alert leaves for a third-party chat service.

test("a phone number never reaches the alert", () => {
  const detail =
    'duplicate key value violates unique constraint "users_phone_key" ' +
    "DETAIL: Key (phone)=(+2348069293636) already exists.";
  const clean = scrub(detail);
  assert.ok(!clean.includes("2348069293636"));
  assert.match(clean, /users_phone_key/, "the useful part survives");
});

test("a connection string never reaches the alert", () => {
  const clean = scrub("connect failed: postgres://app_rw:hunter2@ep-x.neon.tech/db");
  assert.ok(!clean.includes("hunter2"));
});

test("scrubbing happens on the way out, not at the call site", async () => {
  const fake = new FakeAlerter();
  const alerts = new Alerts(fake);
  const app = serverThatThrows(
    alerts,
    new Error("failed for +234 806 929 3636"),
  );

  await app.inject({ method: "GET", url: "/explode" });
  assert.ok(!fake.sent[0]!.message.includes("929"));
});

// ---- fingerprinting ------------------------------------------------------

test("the same bug on different events is one fingerprint", () => {
  const err = new Error("nope");
  assert.equal(
    fingerprint(err, "/events/:id/guests"),
    fingerprint(err, "/events/:id/guests"),
  );
});

test("different routes are different fingerprints", () => {
  const err = new Error("nope");
  assert.notEqual(fingerprint(err, "/a"), fingerprint(err, "/b"));
});

// ---- the webhook itself --------------------------------------------------

test("the webhook body suits Slack and Discord at once", async () => {
  const captured: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), body: String(init.body) });
    return new Response("ok");
  }) as unknown as typeof fetch;

  await new WebhookAlerter("https://hooks.example/abc", fetchImpl).send({
    kind: "http_500",
    fingerprint: "f",
    message: "Error: boom",
    where: "GET /explode",
    requestId: "req-1",
  });

  assert.equal(captured.length, 1);
  const body = JSON.parse(captured[0]!.body);
  assert.ok(body.text.includes("boom"), "Slack reads text");
  assert.equal(body.content, body.text, "Discord reads content");
  assert.equal(body.kind, "http_500", "and the structured form is still there");
});

// ---- the crash path ------------------------------------------------------
//
// Staying up after an unhandled rejection means serving a wedding from a
// process whose state nobody can describe. Render restarts in seconds and
// the scanner queues through it; there is no recovery from quietly wrong
// answers.

test("an unhandled rejection alerts and then takes the process down", async () => {
  const fake = new FakeAlerter();
  const app = Fastify({ logger: false });
  const exited: number[] = [];

  const die = crashHandler(app, new Alerts(fake), (code) => exited.push(code));
  die("unhandled_rejection")(new Error("a promise nobody caught"));

  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0]!.kind, "unhandled_rejection");

  // The delay exists so the log flushes and the alert leaves first.
  assert.deepEqual(exited, [], "not instantly");
  await new Promise((r) => globalThis.setTimeout(r, 1_200));
  assert.deepEqual(exited, [1], "but it does die");
});

test("a non-Error rejection still names something useful", async () => {
  const fake = new FakeAlerter();
  const app = Fastify({ logger: false });

  crashHandler(app, new Alerts(fake), () => {})("uncaught_exception")(
    "just a string",
  );

  assert.match(fake.sent[0]!.message, /just a string/);
});

test("a failing webhook never becomes our problem", async () => {
  const exploding: Alerter = {
    async send() {
      throw new Error("the alerting service is down");
    },
  };
  const app = serverThatThrows(new Alerts(exploding));

  const res = await app.inject({ method: "GET", url: "/explode" });
  assert.equal(res.statusCode, 500, "the request still answers");
});
