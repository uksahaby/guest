// Payments. The rule under test throughout: nothing upgrades a plan except
// a signed webhook, and the amount comes from our own quoted row.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { StubProvider } from "./paystack.ts";
import { PLANS } from "./plans.ts";

const provider = new StubProvider();
const app = buildServer({ provider });
before(() => app.ready());
after(async () => {
  await app.close();
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

async function organiser() {
  const id = randomUUID();
  await sql`insert into users (id, phone, full_name, email)
    values (${id}, ${phone()}, 'Ahmed', ${`ahmed-${id.slice(0, 8)}@example.com`})`;
  return { id, token: app.jwt.sign({ sub: id }) };
}

function call(token: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function newEvent(token: string) {
  const res = await call(token, "POST", "/events", {
    name: "Ahmed & Aisha",
    leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
  });
  assert.equal(res.statusCode, 201);
  return res.json();
}

/** Add a household of `allowance` people and mark its invitation sent. */
async function household(token: string, event: { id: string; legs: { id: string }[] }, allowance: number) {
  const inv = (
    await call(token, "POST", `/events/${event.id}/invitations`, {
      display_name: `Household ${randomUUID().slice(0, 6)}`,
      primary_phone: phone(),
      legs: [{ leg_id: event.legs[0]!.id, allowance }],
    })
  ).json();
  return inv.id as string;
}

/** A webhook exactly as Paystack sends one, correctly signed. */
function webhook(payload: unknown, opts?: { signature?: string }) {
  const raw = JSON.stringify(payload);
  const signature =
    opts?.signature ??
    createHmac("sha512", provider.devKey).update(raw).digest("hex");
  return app.inject({
    method: "POST",
    url: "/webhooks/paystack",
    headers: { "content-type": "application/json", "x-paystack-signature": signature },
    payload: raw,
  });
}

function chargeSuccess(reference: string, amountMinor: number) {
  return {
    event: "charge.success",
    data: { reference, amount: amountMinor, status: "success" },
  };
}

// ------------------------------------------------------------------ billing

test("a new event starts free, with the plan chooser priced by the server", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const res = await call(o.token, "GET", `/events/${event.id}/billing`);
  assert.equal(res.statusCode, 200);
  const b = res.json();

  assert.equal(b.plan, "free");
  assert.equal(b.people_limit, 150);
  assert.equal(b.billable_people, 0);
  assert.equal(b.over_limit, false);
  assert.equal(b.amount_paid_minor, 0);
  assert.equal(b.currency, "NGN");

  const standard = b.plans.find((p: { code: string }) => p.code === "standard");
  assert.equal(standard.amount_minor, 15_000 * 100, "prices are kobo, integers");
  assert.equal(standard.price, "₦15,000");
  assert.equal(standard.people_limit, 600);
});

test("billing counts the largest allowance across legs, not the sum", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legA = event.legs[0].id;

  // A second ceremony, and one household invited to both.
  const legB = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legB}, ${event.id}, 'Traditional', 2, now())`;
  const invId = await household(o.token, event, 6);
  await sql`insert into invitation_legs (invitation_id, leg_id, allowance)
    values (${invId}, ${legB}, 2)`;

  const b = (await call(o.token, "GET", `/events/${event.id}/billing`)).json();
  // Six at one leg and two at the other is six humans, not eight.
  assert.equal(b.billable_people, 6);
  // Six people fit the free tier — the cheapest plan that fits is free.
  assert.equal(b.suggested_plan, "free");
  assert.equal(b.over_limit, false);
  assert.ok(legA);
});

test("over the limit is reported, and gates nothing", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  for (let i = 0; i < 4; i++) await household(o.token, event, 40); // 160 > 150

  const b = (await call(o.token, "GET", `/events/${event.id}/billing`)).json();
  assert.equal(b.billable_people, 160);
  assert.equal(b.over_limit, true);
  assert.equal(b.suggested_plan, "small");
  // Still free, still open — the overage is an invoice, not a barrier.
  assert.equal(b.plan, "free");
});

test("another organiser cannot read this event's billing", async () => {
  const o = await organiser();
  const stranger = await organiser();
  const event = await newEvent(o.token);
  assert.equal(
    (await call(stranger.token, "GET", `/events/${event.id}/billing`)).statusCode,
    403,
  );
});

// ----------------------------------------------------------------- checkout

test("checkout quotes the server's price and records a pending payment", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const res = await call(o.token, "POST", `/events/${event.id}/checkout`, {
    plan: "standard",
  });
  assert.equal(res.statusCode, 200);
  const { authorization_url, reference } = res.json();
  assert.ok(authorization_url.includes(reference));

  const [pay] = await sql`
    select plan, people_limit, amount_minor, currency, status, provider
    from payments where provider_ref = ${reference}`;
  assert.equal(pay!.plan, "standard");
  assert.equal(pay!.people_limit, 600);
  assert.equal(Number(pay!.amount_minor), 15_000 * 100);
  assert.equal(pay!.currency, "NGN");
  assert.equal(pay!.status, "pending");
  assert.equal(pay!.provider, "paystack");

  // Nothing has changed about the event yet — payment is not intent.
  const [ev] = await sql`select plan, people_limit from events where id = ${event.id}`;
  assert.equal(ev!.plan, "free");
  assert.equal(ev!.people_limit, 150);

  // The provider was asked for exactly the catalogue amount.
  const sent = provider.initialised.find((i) => i.reference === reference);
  assert.equal(sent!.amountMinor, PLANS.standard.amountMinor);
});

test("a client cannot name its own price", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  // There is no amount field to tamper with; anything extra is ignored.
  const res = await call(o.token, "POST", `/events/${event.id}/checkout`, {
    plan: "grand",
    amount: 100,
    amount_minor: 100,
    people_limit: 999_999,
  });
  assert.equal(res.statusCode, 200);
  const [pay] = await sql`
    select amount_minor, people_limit from payments
    where provider_ref = ${res.json().reference}`;
  assert.equal(Number(pay!.amount_minor), PLANS.grand.amountMinor);
  assert.equal(pay!.people_limit, PLANS.grand.peopleLimit);
});

test("nonsense plans, free, subscriptions and downgrades are refused", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const bad = await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "platinum" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, "bad_plan");

  const free = await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "free" });
  assert.equal(free.json().code, "nothing_to_pay");

  const sub = await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "professional" });
  assert.equal(sub.json().code, "not_per_event");

  const other = await call(o.token, "POST", `/events/${event.id}/checkout`, {
    plan: "standard",
    provider: "flutterwave",
  });
  assert.equal(other.json().code, "unsupported_provider");

  // Now buy Standard properly, then try to "buy" Small.
  const ref = (await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "standard" })).json().reference;
  await webhook(chargeSuccess(ref, PLANS.standard.amountMinor));
  const down = await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "small" });
  assert.equal(down.statusCode, 409);
  assert.equal(down.json().code, "no_upgrade");
});

test("checkout asks for an email when the account has none", async () => {
  const id = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${id}, ${phone()}, 'No Email')`;
  const token = app.jwt.sign({ sub: id });
  const event = await newEvent(token);

  const missing = await call(token, "POST", `/events/${event.id}/checkout`, { plan: "small" });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, "email_required");

  const given = await call(token, "POST", `/events/${event.id}/checkout`, {
    plan: "small",
    email: "couple@example.com",
  });
  assert.equal(given.statusCode, 200);
});

test("a stranger cannot start a payment on someone else's event", async () => {
  const o = await organiser();
  const stranger = await organiser();
  const event = await newEvent(o.token);
  const res = await call(stranger.token, "POST", `/events/${event.id}/checkout`, {
    plan: "standard",
  });
  assert.equal(res.statusCode, 403);
  const [count] = await sql`select count(*)::int as n from payments where event_id = ${event.id}`;
  assert.equal(count!.n, 0);
});

// ------------------------------------------------------------------ webhook

test("an unsigned or wrongly signed webhook changes nothing", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const { reference } = (
    await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "standard" })
  ).json();

  // No signature at all.
  const none = await app.inject({
    method: "POST",
    url: "/webhooks/paystack",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(chargeSuccess(reference, PLANS.standard.amountMinor)),
  });
  assert.equal(none.statusCode, 401);

  // A plausible but wrong digest.
  const wrong = await webhook(chargeSuccess(reference, PLANS.standard.amountMinor), {
    signature: createHmac("sha512", "not-the-key").update("x").digest("hex"),
  });
  assert.equal(wrong.statusCode, 401);

  const [ev] = await sql`select plan, people_limit from events where id = ${event.id}`;
  assert.equal(ev!.plan, "free", "an unsigned webhook upgraded the plan");
  assert.equal(ev!.people_limit, 150);
  const [pay] = await sql`select status from payments where provider_ref = ${reference}`;
  assert.equal(pay!.status, "pending");
});

test("a signed charge.success upgrades the plan and the headroom", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const { reference } = (
    await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "large" })
  ).json();

  const res = await webhook(chargeSuccess(reference, PLANS.large.amountMinor));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "applied");

  const [ev] = await sql`select plan, people_limit, paid_at from events where id = ${event.id}`;
  assert.equal(ev!.plan, "large");
  assert.equal(ev!.people_limit, 1_200);
  assert.ok(ev!.paid_at);

  const [pay] = await sql`select status, paid_at from payments where provider_ref = ${reference}`;
  assert.equal(pay!.status, "successful");
  assert.ok(pay!.paid_at);

  // And the paywall has moved: the billing view agrees.
  const b = (await call(o.token, "GET", `/events/${event.id}/billing`)).json();
  assert.equal(b.plan, "large");
  assert.equal(b.amount_paid_minor, PLANS.large.amountMinor);
});

test("a replayed webhook is acknowledged but applied once", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const { reference } = (
    await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "standard" })
  ).json();

  const first = await webhook(chargeSuccess(reference, PLANS.standard.amountMinor));
  const second = await webhook(chargeSuccess(reference, PLANS.standard.amountMinor));
  const third = await webhook(chargeSuccess(reference, PLANS.standard.amountMinor));

  assert.equal(first.json().outcome, "applied");
  assert.equal(second.json().outcome, "already_applied");
  assert.equal(third.json().outcome, "already_applied");
  // 200 throughout: a non-2xx makes Paystack retry forever.
  for (const r of [first, second, third]) assert.equal(r.statusCode, 200);

  const [count] = await sql`
    select count(*)::int as n from payments
    where event_id = ${event.id} and status = 'successful'`;
  assert.equal(count!.n, 1);
});

test("a signed webhook whose amount disagrees with the quote is refused", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const { reference } = (
    await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: "grand" })
  ).json();

  // Correctly signed, but claiming ₦100 for the ₦40,000 plan.
  const res = await webhook(chargeSuccess(reference, 100 * 100));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "amount_mismatch");

  const [ev] = await sql`select plan, people_limit from events where id = ${event.id}`;
  assert.equal(ev!.plan, "free", "a short payment bought the Grand plan");
  assert.equal(ev!.people_limit, 150);
  const [pay] = await sql`select status from payments where provider_ref = ${reference}`;
  assert.equal(pay!.status, "failed");
});

test("a webhook for an unknown reference is acknowledged, not retried", async () => {
  const res = await webhook(chargeSuccess("evt_nothing_here", 100));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "unknown_reference");
});

test("events we do not act on are acknowledged so retries stop", async () => {
  const res = await webhook({
    event: "charge.dispute.create",
    data: { reference: "evt_whatever", amount: 1 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ignored, "charge.dispute.create");
});

test("the whole loop: over limit → checkout → webhook → headroom", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  for (let i = 0; i < 5; i++) await household(o.token, event, 40); // 200 people

  let b = (await call(o.token, "GET", `/events/${event.id}/billing`)).json();
  assert.equal(b.billable_people, 200);
  assert.equal(b.over_limit, true);
  assert.equal(b.suggested_plan, "small");

  const { reference } = (
    await call(o.token, "POST", `/events/${event.id}/checkout`, { plan: b.suggested_plan })
  ).json();
  assert.equal((await webhook(chargeSuccess(reference, PLANS.small.amountMinor))).json().outcome, "applied");

  b = (await call(o.token, "GET", `/events/${event.id}/billing`)).json();
  assert.equal(b.plan, "small");
  assert.equal(b.people_limit, 300);
  assert.equal(b.over_limit, false);
  assert.equal(b.amount_paid_minor, 7_500 * 100);
});
