// The platform administrator, and the line drawn around them.
//
// Most of these tests are about what an admin CANNOT do. The dashboard's
// numbers are the easy part; the reason this file exists is that a super
// admin is the first thing in the product that steps outside RLS, and the
// guarantee that it only steps as far as intended has to be checked rather
// than remembered.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, sqlPlatform, closeDb } from "./db.ts";
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

async function person(opts: { admin?: boolean } = {}) {
  const id = randomUUID();
  await sql`
    insert into users (id, phone, full_name, is_platform_admin)
    values (${id}, ${phone()}, 'Zakia Waziri', ${opts.admin ?? false})`;
  return { id, token: app.jwt.sign({ sub: id }) };
}

function call(token: string, url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function newEvent(token: string) {
  const res = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: "Ahmed & Aisha",
      leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
    },
  });
  assert.equal(res.statusCode, 201);
  return res.json();
}

// ---- who may look -------------------------------------------------------

test("an ordinary organiser cannot reach the platform dashboard", async () => {
  const o = await person();
  const res = await call(o.token, "/admin/overview");
  assert.equal(res.statusCode, 403);
  // Not "you are not an admin": whether platform administration exists at
  // all is not worth confirming to somebody trying the address.
  assert.equal(res.json().message, "Not found.");
});

test("no token is refused before the flag is ever consulted", async () => {
  const res = await app.inject({ method: "GET", url: "/admin/overview" });
  assert.equal(res.statusCode, 401);
});

test("the flag is what grants it, and revoking takes it away", async () => {
  const a = await person({ admin: true });
  assert.equal((await call(a.token, "/admin/overview")).statusCode, 200);

  await sql`update users set is_platform_admin = false where id = ${a.id}`;
  assert.equal((await call(a.token, "/admin/overview")).statusCode, 403);
});

// ---- the line around what an admin can see ------------------------------

test("app_admin cannot read a guest list, at the database", async () => {
  // The API never asks for these. This checks the permission itself, so
  // that a future query written in good faith fails loudly rather than
  // quietly returning somebody's wedding.
  for (const table of [
    "invitations", "invitation_legs", "passes", "check_in_events", "seating_tables",
  ]) {
    await assert.rejects(
      () => sqlPlatform().unsafe(`select count(*) from ${table}`),
      (err: Error) => /permission denied/i.test(err.message),
      `app_admin could read ${table}`,
    );
  }
});

test("app_admin cannot read a signing key", async () => {
  await assert.rejects(
    () => sqlPlatform()`select signing_key from events limit 1`,
    (err: Error) => /permission denied/i.test(err.message),
  );
});

test("app_admin cannot write anything at all", async () => {
  await assert.rejects(
    () => sqlPlatform()`update events set name = 'mine' where true`,
    (err: Error) => /permission denied/i.test(err.message),
  );
});

test("guests are counted without being read", async () => {
  const o = await person();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  await app.inject({
    method: "POST",
    url: `/events/${event.id}/invitations`,
    headers: { authorization: `Bearer ${o.token}` },
    payload: { display_name: "Mr & Mrs Adeyemi", legs: [{ leg_id: legId, allowance: 4 }] },
  });

  const [row] = await sqlPlatform()`
    select households, people from admin_event_size(${event.id}::uuid)`;
  assert.equal(row!.households, 1);
  assert.equal(row!.people, 4);

  // The count came back; the name behind it is still out of reach.
  await assert.rejects(
    () => sqlPlatform()`select display_name from invitations limit 1`,
    (err: Error) => /permission denied/i.test(err.message),
  );
});

// ---- the numbers --------------------------------------------------------

test("the dashboard counts what is actually there", async () => {
  const a = await person({ admin: true });
  const o = await person();
  const event = await newEvent(o.token);

  const before = (await call(a.token, "/admin/overview?days=30")).json();

  const r = await app.inject({
    method: "POST",
    url: `/events/${event.id}/checkout`,
    headers: { authorization: `Bearer ${o.token}` },
    // Paystack wants an address for the receipt, and this organiser has none.
    payload: { plan: "standard", email: "zakia@example.com" },
  });
  assert.equal(r.statusCode, 200, JSON.stringify(r.json()));
  const { reference } = r.json();
  await sql`
    update payments set status = 'successful', paid_at = now()
    where provider_ref = ${reference}`;

  const after = (await call(a.token, "/admin/overview?days=30")).json();

  assert.equal(
    after.totals.revenue_minor - before.totals.revenue_minor,
    PLANS.standard.amountMinor,
    "a settled payment moves total revenue by exactly its amount",
  );
  assert.ok(after.totals.events.value >= 1);
  assert.ok(after.totals.organisers.value >= 1);

  // The ring must agree with the number printed above it.
  const s = after.events_by_status;
  assert.equal(
    s.upcoming + s.ongoing + s.completed + s.cancelled + s.draft,
    s.total,
    "every event lands in exactly one slice",
  );

  // One point per day, so a quiet day is a zero and not a gap.
  assert.equal(after.revenue_series.length, 31);
  assert.ok(after.transactions.some((t: { reference: string }) => t.reference === reference));
});

test("health reports what is configured, not what looks good", async () => {
  const a = await person({ admin: true });
  const { health } = (await call(a.token, "/admin/overview")).json();
  const by = (name: string) =>
    health.find((h: { name: string }) => h.name === name);

  assert.equal(by("Database").state, "operational");
  // The test environment has no Termii key and no email channel; the
  // dashboard says so rather than showing a green light.
  assert.equal(by("SMS").state, "not_configured");
  assert.equal(by("Email").state, "not_built");
});
