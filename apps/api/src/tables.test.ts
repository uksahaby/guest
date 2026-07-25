// Seating. The rule that shapes every number here: a seat is a PERSON, so
// a household of four takes four seats.
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
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
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

async function household(token: string, eventId: string, legId: string, name: string, allowance: number) {
  const res = await call(token, "POST", `/events/${eventId}/invitations`, {
    display_name: name,
    primary_phone: phone(),
    legs: [{ leg_id: legId, allowance }],
  });
  assert.equal(res.statusCode, 201);
  return res.json().id as string;
}

// -------------------------------------------------------------- creating

test("a named table is created and switches seating on for the leg", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const res = await call(o.token, "POST", `/legs/${legId}/tables`, {
    name: "VIP Table",
    capacity: 8,
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.created, 1);
  assert.equal(body.total_tables, 1);
  assert.equal(body.total_capacity, 8);
  assert.equal(body.tables[0].name, "VIP Table");
  assert.equal(body.tables[0].seats_used, 0);

  const [leg] = await sql`select tables_enabled from event_legs where id = ${legId}`;
  assert.equal(leg!.tables_enabled, true, "tables mean nothing if the leg denies having them");
});

test("a run of tables is created in one go — nobody types 42 names", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const res = await call(o.token, "POST", `/legs/${legId}/tables`, {
    count: 42,
    capacity: 10,
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.created, 42);
  assert.equal(body.total_tables, 42);
  assert.equal(body.total_capacity, 420);

  const names = body.tables.map((t: { name: string }) => t.name);
  assert.ok(names.includes("Table 1"));
  assert.ok(names.includes("Table 42"));
});

test("adding more tables continues the numbering instead of colliding", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  await call(o.token, "POST", `/legs/${legId}/tables`, { count: 5, capacity: 10 });
  const res = await call(o.token, "POST", `/legs/${legId}/tables`, { count: 3, capacity: 10 });
  assert.equal(res.json().created, 3);
  assert.equal(res.json().total_tables, 8);

  const names = res.json().tables.map((t: { name: string }) => t.name).sort();
  assert.ok(names.includes("Table 6") && names.includes("Table 8"));
});

test("a custom prefix is honoured", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const res = await call(o.token, "POST", `/legs/${event.legs[0].id}/tables`, {
    count: 3,
    prefix: "Round",
    capacity: 12,
  });
  const names = res.json().tables.map((t: { name: string }) => t.name);
  assert.deepEqual(names.sort(), ["Round 1", "Round 2", "Round 3"]);
});

test("nonsense capacities and counts are refused", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  assert.equal(
    (await call(o.token, "POST", `/legs/${legId}/tables`, { name: "T", capacity: 0 })).json().code,
    "bad_capacity",
  );
  assert.equal(
    (await call(o.token, "POST", `/legs/${legId}/tables`, { count: 9999 })).json().code,
    "bad_count",
  );
  assert.equal(
    (await call(o.token, "POST", `/legs/${legId}/tables`, {})).json().code,
    "bad_request",
  );
});

// ---------------------------------------------------------------- seating

test("a seat is a person: a household of four fills four seats", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const tables = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { count: 2, capacity: 10 })
  ).json();
  const table1 = tables.tables.find((t: { name: string }) => t.name === "Table 1");

  const adeyemi = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  const okafor = await household(o.token, event.id, legId, "The Okafor Family", 6);

  for (const inv of [adeyemi, okafor]) {
    const res = await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, {
      table_id: table1.id,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().table_id, table1.id);
  }

  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  const seated = plan.tables.find((t: { id: string }) => t.id === table1.id);
  assert.equal(seated.seats_used, 10, "4 + 6 people, not 2 households");
  assert.equal(seated.households, 2);
  assert.equal(seated.over_capacity, false);
  assert.deepEqual(seated.who.sort(), ["Mr & Mrs Adeyemi", "The Okafor Family"]);

  assert.equal(plan.seated_people, 10);
  assert.equal(plan.unseated_households, 0);
});

test("over capacity is reported, never refused", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Small", capacity: 4 })
  ).json().tables[0];

  const big = await household(o.token, event.id, legId, "The Nwosu Family", 7);
  const res = await call(o.token, "PUT", `/invitations/${big}/legs/${legId}`, {
    table_id: table.id,
  });
  assert.equal(res.statusCode, 200, "the organiser decides, not the software");

  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  assert.equal(plan.tables[0].seats_used, 7);
  assert.equal(plan.tables[0].over_capacity, true);
});

test("unseated households are counted in people and listed", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  await call(o.token, "POST", `/legs/${legId}/tables`, { count: 1, capacity: 10 });

  await household(o.token, event.id, legId, "Adaeze Nwosu", 3);
  await household(o.token, event.id, legId, "Emeka Balogun", 2);

  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  assert.equal(plan.unseated_households, 2);
  assert.equal(plan.unseated_people, 5);

  const list = (await call(o.token, "GET", `/legs/${legId}/unseated`)).json();
  assert.equal(list.data.length, 2);
  assert.deepEqual(
    list.data.map((r: { display_name: string }) => r.display_name),
    ["Adaeze Nwosu", "Emeka Balogun"],
  );
});

test("a household can be unseated again by clearing the table", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Table 1", capacity: 10 })
  ).json().tables[0];
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);

  await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, { table_id: table.id });
  const cleared = await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, {
    table_id: null,
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().table_id, null);

  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  assert.equal(plan.unseated_households, 1);
  assert.equal(plan.tables[0].seats_used, 0);
});

test("changing the allowance without touching the table leaves the seat alone", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Table 1", capacity: 10 })
  ).json().tables[0];
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, { table_id: table.id });

  const res = await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, {
    allowance: 6,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().allowance, 6);
  assert.equal(res.json().table_id, table.id, "an omitted table_id must not unseat anyone");

  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  assert.equal(plan.tables[0].seats_used, 6);
});

test("a table from another leg cannot seat this household", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legA = event.legs[0].id;
  const legB = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legB}, ${event.id}, 'Traditional', 2, now())`;

  const tableB = (
    await call(o.token, "POST", `/legs/${legB}/tables`, { name: "Abuja 1", capacity: 10 })
  ).json().tables[0];
  const inv = await household(o.token, event.id, legA, "Mr & Mrs Adeyemi", 4);

  const res = await call(o.token, "PUT", `/invitations/${inv}/legs/${legA}`, {
    table_id: tableB.id,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "wrong_leg_table");
});

test("seating a household that isn't invited to this leg is a 404", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legA = event.legs[0].id;
  const legB = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legB}, ${event.id}, 'Traditional', 2, now())`;

  const inv = await household(o.token, event.id, legA, "Lagos Only", 2);
  const res = await call(o.token, "PUT", `/invitations/${inv}/legs/${legB}`, {
    allowance: 2,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().code, "not_invited");
});

// -------------------------------------------------------- editing, removing

test("a table can be renamed and resized", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Table 1", capacity: 10 })
  ).json().tables[0];

  const res = await call(o.token, "PATCH", `/tables/${table.id}`, {
    name: "Head Table",
    capacity: 12,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().name, "Head Table");
  assert.equal(res.json().capacity, 12);
});

test("deleting a table unseats its households but keeps them on the list", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Table 1", capacity: 10 })
  ).json().tables[0];
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, { table_id: table.id });

  const res = await call(o.token, "DELETE", `/tables/${table.id}`);
  assert.equal(res.statusCode, 204);

  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  assert.equal(plan.total_tables, 0);
  assert.equal(plan.unseated_households, 1, "the household survives its table");

  const [still] = await sql`select display_name from invitations where id = ${inv}`;
  assert.equal(still!.display_name, "Mr & Mrs Adeyemi");
});

// ------------------------------------------------------------------ access

test("a stranger can neither see nor change the seating plan", async () => {
  const o = await organiser();
  const stranger = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Table 1", capacity: 10 })
  ).json().tables[0];
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);

  assert.equal((await call(stranger.token, "GET", `/legs/${legId}/tables`)).statusCode, 403);
  assert.equal((await call(stranger.token, "GET", `/legs/${legId}/unseated`)).statusCode, 403);
  assert.equal(
    (await call(stranger.token, "POST", `/legs/${legId}/tables`, { name: "Mine" })).statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "PATCH", `/tables/${table.id}`, { name: "Mine" })).statusCode,
    403,
  );
  assert.equal((await call(stranger.token, "DELETE", `/tables/${table.id}`)).statusCode, 403);
  assert.equal(
    (await call(stranger.token, "PUT", `/invitations/${inv}/legs/${legId}`, { table_id: table.id }))
      .statusCode,
    403,
  );

  // Nothing moved.
  const plan = (await call(o.token, "GET", `/legs/${legId}/tables`)).json();
  assert.equal(plan.total_tables, 1);
  assert.equal(plan.tables[0].name, "Table 1");
});

// -------------------------------------------------- it reaches the guest

test("a seated household's table shows on its pass and at the gate", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const table = (
    await call(o.token, "POST", `/legs/${legId}/tables`, { name: "Table 12", capacity: 10 })
  ).json().tables[0];
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  await call(o.token, "PUT", `/invitations/${inv}/legs/${legId}`, { table_id: table.id });

  // The guest page reads it…
  const link = (
    await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
      invitation_ids: [inv],
    })
  ).json()[0];
  const token = link.invite_url.split("/i/")[1];
  const guest = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(guest.json().legs[0].table_name, "Table 12");

  // …and so does the scanner's offline payload.
  const usher = await organiser();
  await sql`insert into staff_assignments (user_id, leg_id) values (${usher.id}, ${legId})`;
  const boot = await call(usher.token, "GET", `/scanner/legs/${legId}/bootstrap`);
  assert.equal(boot.json().invitations[0].table_name, "Table 12");
});
