// SMS delivery on the login path. The rules under test:
//   · a code is only promised once it has actually been handed to a sender
//   · a failed send leaves no row behind, so the user can retry at once
//   · dev_code never leaves the server when a real sender is configured
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { LogSender, FailingSender, TermiiSender, SmsSendError, type SmsSender } from "./sms.ts";

const logSender = new LogSender();
const app = buildServer({ sms: logSender });

const failing = new FailingSender();
const failApp = buildServer({ sms: failing });

// A sender that delivers but claims to be real — the dev_code gate.
const realish: SmsSender = { name: "realish", echoesCodes: false, async send() {} };
const realApp = buildServer({ sms: realish });

before(async () => {
  await Promise.all([app.ready(), failApp.ready(), realApp.ready()]);
});
after(async () => {
  await Promise.all([app.close(), failApp.close(), realApp.close()]);
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

const request = (a: typeof app, p: string) =>
  a.inject({ method: "POST", url: "/auth/otp/request", payload: { phone: p } });

const codeRows = (p: string) =>
  sql`select id, consumed_at from auth_otp_codes where phone = ${p}`;

// ---- the sender actually gets the message ------------------------------

test("the code that reaches the sender is the code that verifies", async () => {
  const p = phone();
  const before = logSender.sent.length;
  const res = await request(app, p);
  assert.equal(res.statusCode, 202);

  const msg = logSender.sent[before];
  assert.ok(msg, "nothing was handed to the sender");
  assert.equal(msg.to, p);

  const sixDigits = msg.text.match(/\b(\d{6})\b/)?.[1];
  assert.ok(sixDigits, `no code in the message: ${msg.text}`);
  assert.equal(sixDigits, res.json().dev_code);

  const verified = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    payload: { phone: p, code: sixDigits },
  });
  assert.equal(verified.statusCode, 200);
});

test("the message says what it is and warns against sharing", async () => {
  const p = phone();
  await request(app, p);
  const text = logSender.sent.at(-1)!.text;
  assert.match(text, /sign-in code/i);
  assert.match(text, /expires in 10 minutes/i);
  assert.match(text, /do not share/i);
  // Two SMS pages cost twice as much and gain nothing.
  assert.ok(text.length <= 160, `message is ${text.length} chars, over one SMS page`);
});

// ---- delivery failure ---------------------------------------------------

test("a failed send returns 502 rather than a silent 202", async () => {
  const res = await request(failApp, phone());
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().code, "sms_failed");
  assert.equal(res.json().dev_code, undefined);
});

test("a failed send leaves no code row behind", async () => {
  const p = phone();
  await request(failApp, p);
  assert.equal((await codeRows(p)).length, 0);
});

test("a failed send does not rate-limit the retry", async () => {
  const p = phone();
  assert.equal((await request(failApp, p)).statusCode, 502);
  // Immediately again: with the row deleted there is nothing to throttle
  // against, so the user is not punished 30 seconds for our outage.
  assert.equal((await request(failApp, p)).statusCode, 502);
});

test("a failed send does not resurrect the previous code", async () => {
  const p = phone();
  const { dev_code } = (await request(app, p)).json();
  await sql`update auth_otp_codes set created_at = now() - interval '1 minute'
    where phone = ${p}`;

  assert.equal((await request(failApp, p)).statusCode, 502);

  // The earlier code was invalidated when the new one was issued, and the
  // rollback must not undo that — it deletes only the row it created.
  const rows = await codeRows(p);
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.consumed_at, "the superseded code should stay consumed");

  const verified = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    payload: { phone: p, code: dev_code },
  });
  assert.equal(verified.statusCode, 401);
});

// ---- the dev_code gate --------------------------------------------------

test("dev_code is withheld whenever the sender is a real one", async () => {
  const res = await request(realApp, phone());
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().dev_code, undefined);
  assert.equal(res.json().retry_after_seconds, 30);
});

test("a real sender still stores a working code", async () => {
  const p = phone();
  await request(realApp, p);
  const rows = await codeRows(p);
  assert.equal(rows.length, 1);
});

test("only the log sender advertises that it echoes codes", () => {
  assert.equal(new LogSender().echoesCodes, true);
  assert.equal(new TermiiSender("k", "N-Alert", "dnd").echoesCodes, false);
  assert.equal(failing.echoesCodes, false);
});

// ---- the Termii request shape ------------------------------------------
//
// The wire format is pinned here because getting it wrong fails in the one
// way that costs a day: Termii accepts the message, answers "ok", and
// never delivers it.

async function captureTermii(
  reply: { status?: number; body?: unknown } = {},
): Promise<{ body: Record<string, unknown>; error?: unknown }> {
  const original = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string);
    return new Response(JSON.stringify(reply.body ?? { code: "ok", message_id: "1" }), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const sender = new TermiiSender("secret-key", "Adeyemi", "dnd");
  let error: unknown;
  try {
    await sender.send({ to: "+2348034112098", text: "123456 is your code." });
  } catch (err) {
    error = err;
  } finally {
    globalThis.fetch = original;
  }
  return { body: captured, error };
}

test("the Termii payload uses the dnd channel and a bare MSISDN", async () => {
  const { body, error } = await captureTermii();
  assert.equal(error, undefined);
  assert.equal(body.api_key, "secret-key");
  // Termii wants 234…, not +234…; the + is silently accepted and undelivered.
  assert.equal(body.to, "2348034112098");
  assert.equal(body.from, "Adeyemi");
  assert.equal(body.sms, "123456 is your code.");
  assert.equal(body.type, "plain");
  assert.equal(body.channel, "dnd");
});

test("a Termii error body is a failure even when the status is 200", async () => {
  const { error } = await captureTermii({
    status: 200,
    body: { code: "invalid_sender_id", message: "Sender ID not approved" },
  });
  assert.ok(error instanceof SmsSendError, `expected SmsSendError, got ${error}`);
  assert.match((error as Error).message, /Sender ID not approved/);
});

test("an HTTP error from Termii is a failure", async () => {
  const { error } = await captureTermii({ status: 401, body: { message: "Bad key" } });
  assert.ok(error instanceof SmsSendError);
});

test("an unreachable Termii is a failure, not a hang", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => new TermiiSender("k", "N-Alert", "dnd").send({ to: "+234803", text: "x" }),
      SmsSendError,
    );
  } finally {
    globalThis.fetch = original;
  }
});
