// Gates and the people on them.
//
// The test that matters is the last one: an organiser sets up a gate, adds
// an usher, and that usher scans someone in — with no SQL seeding anywhere.
// Every other test in this repo seeded staff_assignments and entrances
// directly, which is exactly what hid the fact that neither could be
// created through the product at all.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";

const app = buildServer();
before(() => app.ready());
after(async () => {
  await app.close();
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

async function organiser() {
  const id = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${id}, ${phone()}, 'Ahmed')`;
  return { id, token: app.jwt.sign({ sub: id }) };
}

function call(
  token: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
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

// -------------------------------------------------------------------- gates

test("an organiser can create gates and see them", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const created = await call(o.token, "POST", `/legs/${legId}/entrances`, {
    name: "Main Gate",
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().name, "Main Gate");
  assert.equal(created.json().is_active, true);

  await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Side Gate" });

  const list = await call(o.token, "GET", `/legs/${legId}/entrances`);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(
    list.json().map((e: { name: string }) => e.name),
    ["Main Gate", "Side Gate"],
  );
  assert.equal(list.json()[0].admitted, 0);
  assert.equal(list.json()[0].ushers, 0);
});

test("a gate needs a name, and two gates cannot share one", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  assert.equal(
    (await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "  " })).json().code,
    "bad_name",
  );
  await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" });
  const dupe = await call(o.token, "POST", `/legs/${legId}/entrances`, {
    name: "Main Gate",
  });
  assert.equal(dupe.statusCode, 409);
  assert.equal(dupe.json().code, "gate_exists");
});

test("a gate can be renamed and closed", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const gate = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" })
  ).json();

  const renamed = await call(o.token, "PATCH", `/entrances/${gate.id}`, {
    name: "Front Gate",
    is_active: false,
  });
  assert.equal(renamed.json().name, "Front Gate");
  assert.equal(renamed.json().is_active, false);
});

test("an unused gate is deleted; one with scans is kept on the record", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const unused = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Never Opened" })
  ).json();
  const used = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" })
  ).json();

  // A gate nobody came through is just a mistake — remove it.
  assert.equal((await call(o.token, "DELETE", `/entrances/${unused.id}`)).statusCode, 204);

  // One scan through the other, and it becomes history.
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, entrance_id, staff_user_id, result,
       admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${event.id}, ${legId}, ${used.id}, ${o.id},
       'invalid', 0, 0, now())`;

  const refused = await call(o.token, "DELETE", `/entrances/${used.id}`);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, "gate_has_history");
  assert.match(refused.json().message, /Close it instead/);

  // Closing it is the way, and the scan is untouched.
  const closed = await call(o.token, "PATCH", `/entrances/${used.id}`, {
    is_active: false,
  });
  assert.equal(closed.json().is_active, false);
  const [count] = await sql`
    select count(*)::int as n from check_in_events where entrance_id = ${used.id}`;
  assert.equal(count!.n, 1, "what happened at that gate stays on the record");
});

// -------------------------------------------------------------------- staff

test("an usher is invited by phone, and an account appears for them", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const gate = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" })
  ).json();

  const musaPhone = phone();
  const res = await call(o.token, "POST", `/legs/${legId}/staff`, {
    phone: musaPhone,
    full_name: "Musa",
    entrance_id: gate.id,
  });
  assert.equal(res.statusCode, 201);
  const a = res.json();
  assert.equal(a.user.phone, musaPhone);
  assert.equal(a.user.full_name, "Musa");
  assert.equal(a.role, "usher");
  assert.equal(a.entrance_id, gate.id);

  // Defaults are closed — manual entry is the most abusable action.
  assert.equal(a.can_override, false, "override must not be granted by omission");
  assert.equal(a.can_walk_in, false);
  assert.equal(a.can_manual, true, "but searching by name is the ordinary path");

  // An account exists with no password: the OTP they request is the signup.
  const [user] = await sql`
    select password_hash, full_name from users where phone = ${musaPhone}`;
  assert.equal(user!.password_hash, null);
  assert.equal(user!.full_name, "Musa");
});

test("inviting an existing person reuses their account and keeps their name", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const existing = phone();
  await sql`insert into users (phone, full_name) values (${existing}, 'Ifeoma Okoro')`;

  const res = await call(o.token, "POST", `/legs/${legId}/staff`, {
    phone: existing,
    full_name: "Wrong Name",
  });
  assert.equal(res.statusCode, 201);
  assert.equal(
    res.json().user.full_name,
    "Ifeoma Okoro",
    "an organiser typing a name must not rename an existing person",
  );

  const [count] = await sql`select count(*)::int as n from users where phone = ${existing}`;
  assert.equal(count!.n, 1, "no duplicate account");
});

test("re-inviting the same usher moves them rather than doubling them", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const main = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" })
  ).json();
  const side = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Side Gate" })
  ).json();

  const musa = phone();
  await call(o.token, "POST", `/legs/${legId}/staff`, {
    phone: musa,
    full_name: "Musa",
    entrance_id: main.id,
  });
  await call(o.token, "POST", `/legs/${legId}/staff`, {
    phone: musa,
    full_name: "Musa",
    entrance_id: side.id,
    can_walk_in: true,
  });

  const list = (await call(o.token, "GET", `/legs/${legId}/staff`)).json();
  assert.equal(list.length, 1, "one person, one assignment per leg");
  assert.equal(list[0].entrance_name, "Side Gate");
  assert.equal(list[0].can_walk_in, true);
});

test("the roster reports readiness — has this usher ever opened the scanner", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const musaPhone = phone();
  await call(o.token, "POST", `/legs/${legId}/staff`, {
    phone: musaPhone,
    full_name: "Musa",
  });

  let list = (await call(o.token, "GET", `/legs/${legId}/staff`)).json();
  assert.equal(list[0].has_tested, false, "nobody has opened it yet");
  assert.equal(list[0].scans, 0);

  // Musa signs in and opens the scanner.
  const req = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    payload: { phone: musaPhone },
  });
  const verify = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    payload: { phone: musaPhone, code: req.json().dev_code },
  });
  const musaToken = verify.json().access_token;
  assert.equal(
    (await call(musaToken, "POST", `/scanner/legs/${legId}/test`)).statusCode,
    204,
  );

  list = (await call(o.token, "GET", `/legs/${legId}/staff`)).json();
  assert.equal(list[0].has_tested, true, "readiness check 8");
  assert.ok(list[0].last_tested_at);
});

test("permissions can be changed afterwards, and access removed", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const musaPhone = phone();
  const a = (
    await call(o.token, "POST", `/legs/${legId}/staff`, {
      phone: musaPhone,
      full_name: "Musa",
    })
  ).json();

  const patched = await call(o.token, "PATCH", `/staff/${a.id}`, {
    can_override: true,
    can_walk_in: true,
  });
  assert.equal(patched.json().can_override, true);
  assert.equal(patched.json().can_walk_in, true);

  assert.equal((await call(o.token, "DELETE", `/staff/${a.id}`)).statusCode, 204);
  assert.equal((await call(o.token, "GET", `/legs/${legId}/staff`)).json().length, 0);
});

test("removing an usher takes away access, not their scans", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const musaPhone = phone();
  const a = (
    await call(o.token, "POST", `/legs/${legId}/staff`, {
      phone: musaPhone,
      full_name: "Musa",
    })
  ).json();
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, staff_user_id, result,
       admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${event.id}, ${legId}, ${a.user.id},
       'invalid', 0, 0, now())`;

  await call(o.token, "DELETE", `/staff/${a.id}`);

  // The morning-after report still knows who was on the gate.
  const [row] = await sql`
    select staff_user_id from check_in_events where event_id = ${event.id}`;
  assert.equal(row!.staff_user_id, a.user.id);
});

test("a gate from another part of the event cannot be assigned", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legA = event.legs[0].id;
  const legB = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legB}, ${event.id}, 'Traditional', 2, now())`;
  const gateB = (
    await call(o.token, "POST", `/legs/${legB}/entrances`, { name: "Abuja Gate" })
  ).json();

  const res = await call(o.token, "POST", `/legs/${legA}/staff`, {
    phone: phone(),
    entrance_id: gateB.id,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "wrong_leg_gate");
});

test("a mangled phone number is refused, and owner cannot be granted", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  assert.equal(
    (await call(o.token, "POST", `/legs/${legId}/staff`, { phone: "08034112098" })).json().code,
    "bad_phone",
    "local format has no country code — it's how they sign in, so it must be exact",
  );
  assert.equal(
    (await call(o.token, "POST", `/legs/${legId}/staff`, { phone: phone(), role: "owner" }))
      .json().code,
    "cannot_grant_owner",
  );
});

// ------------------------------------------------------------------- access

test("an usher cannot manage the team or the gates", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const gate = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" })
  ).json();

  const musaPhone = phone();
  const a = (
    await call(o.token, "POST", `/legs/${legId}/staff`, {
      phone: musaPhone,
      full_name: "Musa",
      entrance_id: gate.id,
    })
  ).json();
  const musaToken = app.jwt.sign({ sub: a.user.id });

  // Musa can work the gate but not run the event.
  assert.equal((await call(musaToken, "GET", `/legs/${legId}/staff`)).statusCode, 403);
  assert.equal((await call(musaToken, "GET", `/legs/${legId}/entrances`)).statusCode, 403);
  assert.equal(
    (await call(musaToken, "POST", `/legs/${legId}/entrances`, { name: "Mine" })).statusCode,
    403,
  );
  assert.equal(
    (await call(musaToken, "PATCH", `/staff/${a.id}`, { can_override: true })).statusCode,
    403,
    "an usher must not be able to grant themselves override",
  );
  assert.equal((await call(musaToken, "DELETE", `/entrances/${gate.id}`)).statusCode, 403);

  // …but the scanner still works for them.
  assert.equal((await call(musaToken, "GET", "/scanner/assignments")).json().length, 1);
});

test("a stranger sees nothing of either", async () => {
  const o = await organiser();
  const stranger = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  assert.equal((await call(stranger.token, "GET", `/legs/${legId}/staff`)).statusCode, 403);
  assert.equal(
    (await call(stranger.token, "POST", `/legs/${legId}/staff`, { phone: phone() })).statusCode,
    403,
  );
});

// ------------------------------------------------- the whole point of all this

test("an organiser sets up a gate and an usher, and that usher checks someone in", async () => {
  // No SQL seeding of entrances or staff anywhere in this test. Until now
  // that was impossible, which is why the gap went unnoticed.
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  // 1. A gate.
  const gate = (
    await call(o.token, "POST", `/legs/${legId}/entrances`, { name: "Main Gate" })
  ).json();

  // 2. An usher on it.
  const musaPhone = phone();
  await call(o.token, "POST", `/legs/${legId}/staff`, {
    phone: musaPhone,
    full_name: "Musa",
    entrance_id: gate.id,
  });

  // 3. A household with a pass.
  const inv = (
    await call(o.token, "POST", `/events/${event.id}/invitations`, {
      display_name: "Mr & Mrs Adeyemi",
      primary_phone: phone(),
      legs: [{ leg_id: legId, allowance: 4 }],
    })
  ).json();

  // 4. Musa signs in with an OTP — he had no account before step 2.
  const otp = await app.inject({
    method: "POST",
    url: "/auth/otp/request",
    payload: { phone: musaPhone },
  });
  const session = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    payload: { phone: musaPhone, code: otp.json().dev_code },
  });
  const musaToken = session.json().access_token;

  // 5. His phone finds the event and downloads the leg.
  const assignments = (await call(musaToken, "GET", "/scanner/assignments")).json();
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].event_name, "Ahmed & Aisha");
  assert.equal(assignments[0].entrance_id, gate.id);

  const boot = (await call(musaToken, "GET", `/scanner/legs/${legId}/bootstrap`)).json();
  assert.equal(boot.entrances.length, 1);
  assert.equal(boot.invitations.length, 1);
  assert.equal(boot.keys.length, 1, "he holds the signing key for this event");
  const [pass] = await sql`select id from passes where invitation_id = ${inv.id}`;

  // 6. He admits three of the four.
  const scan = await call(musaToken, "POST", "/scanner/check-ins", {
    items: [
      {
        client_uuid: randomUUID(),
        leg_id: legId,
        entrance_id: gate.id,
        pass_id: pass!.id,
        result: "partial",
        admitted_count: 3,
        scanned_at: new Date().toISOString(),
        device_id: "musa-phone",
      },
    ],
  });
  assert.equal(scan.statusCode, 200);
  assert.equal(scan.json().results[0].accepted, true);
  assert.equal(scan.json().results[0].contested, false);

  // 7. The organiser sees it, attributed to Musa at his gate.
  const live = (await call(o.token, "GET", `/legs/${legId}/live`)).json();
  assert.equal(live.counters.inside, 3);
  assert.equal(live.feed[0].display_name, "Mr & Mrs Adeyemi");
  assert.equal(live.feed[0].staff_name, "Musa");
  assert.equal(live.feed[0].entrance_name, "Main Gate");

  const gates = (await call(o.token, "GET", `/legs/${legId}/entrances`)).json();
  assert.equal(gates[0].admitted, 3);
  assert.equal(gates[0].ushers, 1);
});
