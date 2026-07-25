// The morning-after report. Built around one seeded night so the numbers
// have to add up against each other, not just individually.
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

/**
 * One event, two gates, and a night with every outcome in it: full arrivals,
 * a partial, a no-show, an overflow party, a manual entry and three
 * refusals.
 */
async function seedNight() {
  const owner = randomUUID();
  const musa = randomUUID();
  const ifeoma = randomUUID();
  const ws = randomUUID();
  const event = randomUUID();
  const leg = randomUUID();
  const main = randomUUID();
  const side = randomUUID();
  const cat = randomUUID();

  await sql`insert into users (id, phone, full_name) values
    (${owner}, ${phone()}, 'Ahmed'),
    (${musa}, ${phone()}, 'Musa'),
    (${ifeoma}, ${phone()}, 'Ifeoma')`;
  await sql`insert into workspaces (id, name, owner_user_id) values (${ws}, 'WS', ${owner})`;
  await sql`insert into events (id, workspace_id, name, signing_key, status)
    values (${event}, ${ws}, 'Ahmed & Aisha', gen_random_bytes(32), 'active')`;
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at, venue_name)
    values (${leg}, ${event}, 'Reception', 1, '2026-12-12 16:00:00+01', 'Oriental Hotel')`;
  await sql`insert into entrances (id, leg_id, name) values
    (${main}, ${leg}, 'Main Gate'), (${side}, ${leg}, 'Side Gate')`;
  await sql`insert into guest_categories (id, event_id, name)
    values (${cat}, ${event}, $$Groom's Family$$)`;
  await sql`insert into staff_assignments (user_id, leg_id, entrance_id) values
    (${musa}, ${leg}, ${main}), (${ifeoma}, ${leg}, ${side})`;

  const make = async (
    name: string,
    allowance: number,
    rsvp: string,
    rsvpCount: number | null,
  ) => {
    const inv = randomUUID();
    const pass = randomUUID();
    await sql`insert into invitations (id, event_id, display_name, primary_phone, category_id)
      values (${inv}, ${event}, ${name}, ${phone()}, ${cat})`;
    await sql`insert into invitation_legs (invitation_id, leg_id, allowance, rsvp, rsvp_count)
      values (${inv}, ${leg}, ${allowance}, ${rsvp}::rsvp_status, ${rsvpCount})`;
    await sql`insert into passes (id, invitation_id, event_id)
      values (${pass}, ${inv}, ${event})`;
    return { inv, pass };
  };

  const scan = async (
    passId: string | null,
    invId: string | null,
    result: string,
    count: number,
    at: string,
    entrance: string,
    staff: string,
  ) => {
    await sql`insert into check_in_events
        (client_uuid, event_id, leg_id, entrance_id, pass_id, invitation_id,
         staff_user_id, result, admitted_count, occupancy_delta,
         scanned_at, recorded_at)
      values (${randomUUID()}, ${event}, ${leg}, ${entrance}, ${passId}, ${invId},
         ${staff}, ${result}::checkin_result, ${count}, ${count},
         ${at}, ${at})`;
  };

  // Adeyemi: invited 4, confirmed 4, all four arrived (3 then 1 later).
  const adeyemi = await make("Mr & Mrs Adeyemi", 4, "attending", 4);
  await scan(adeyemi.pass, adeyemi.inv, "partial", 3, "2026-12-12 17:35:00+01", main, musa);
  await scan(adeyemi.pass, adeyemi.inv, "admitted", 1, "2026-12-12 18:10:00+01", main, musa);

  // Okafor: invited 1, confirmed 1, came — by name search (manual).
  const okafor = await make("Chidinma Okafor", 1, "attending", 1);
  await scan(okafor.pass, okafor.inv, "manual", 1, "2026-12-12 17:50:00+01", side, ifeoma);

  // Balogun: invited 2, confirmed 2, only one turned up.
  const balogun = await make("Emeka Balogun", 2, "attending", 2);
  await scan(balogun.pass, balogun.inv, "partial", 1, "2026-12-12 18:05:00+01", side, ifeoma);

  // Nwosu: invited 4, confirmed 4, five walked in.
  const nwosu = await make("The Nwosu Family", 4, "attending", 4);
  await scan(nwosu.pass, nwosu.inv, "overflow_admitted", 5, "2026-12-12 18:20:00+01", main, musa);

  // Bakare: invited 2, confirmed 2, never came at all.
  await make("Tunde Bakare", 2, "attending", 2);

  // Declined, so not a no-show.
  await make("Ngozi Eze", 3, "declined", 0);

  // Never replied.
  await make("Yusuf Sani", 2, "pending", null);

  // Three refusals, admitting nobody.
  await scan(null, null, "invalid", 0, "2026-12-12 18:22:00+01", main, musa);
  await scan(null, null, "wrong_event", 0, "2026-12-12 18:07:00+01", side, ifeoma);
  await scan(adeyemi.pass, adeyemi.inv, "allowance_exhausted", 0, "2026-12-12 18:41:00+01", main, musa);

  return { owner, token: app.jwt.sign({ sub: owner }), event, leg, main, side };
}

function get(token: string, url: string) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
}

// ------------------------------------------------------------------- totals

test("the report's headline numbers add up", async () => {
  const s = await seedNight();
  const res = await get(s.token, `/events/${s.event}/report`);
  assert.equal(res.statusCode, 200);
  const leg = res.json().legs[0];

  assert.equal(leg.invitations, 7);
  // 4 + 1 + 2 + 4 + 2 + 3 + 2
  assert.equal(leg.invited_people, 18);
  // attending/partial only: 4 + 1 + 2 + 4 + 2 (declined 0, pending null)
  assert.equal(leg.confirmed_people, 13);
  assert.equal(leg.replied_invitations, 6, "everyone but Yusuf replied");
  // 4 + 1 + 1 + 5
  assert.equal(leg.arrived_people, 11);
});

test("no-shows count promised people who never came, and exclude decliners", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];
  // Balogun promised 2 and sent 1; Bakare promised 2 and sent none.
  // Ngozi declined, so she is not a no-show.
  assert.equal(leg.no_shows, 3);
});

test("overflow is reported as people and parties", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];
  assert.equal(leg.overflow_people, 1, "Nwosu sent one more than invited");
  assert.equal(leg.overflow_parties, 1);
});

test("manual check-ins are flagged — the most abusable action", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];
  assert.equal(leg.manual_check_ins, 1);
  assert.equal(leg.manual_households, 1);
});

// ------------------------------------------------------------------ arrivals

test("arrivals are bucketed into half hours", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];

  const total = leg.arrivals_by_half_hour.reduce(
    (n: number, b: { count: number }) => n + b.count,
    0,
  );
  assert.equal(total, leg.arrived_people, "the histogram must sum to arrivals");

  // Buckets are ordered and none is empty.
  const times = leg.arrivals_by_half_hour.map((b: { from: string }) => b.from);
  assert.deepEqual([...times].sort(), times);
  assert.ok(leg.arrivals_by_half_hour.every((b: { count: number }) => b.count > 0));

  // Two blocks only. 17:35 and 17:50 fall in the first (3 + 1 = 4); the
  // 18:00 block took Balogun's 1, Adeyemi's late fourth guest and Nwosu's
  // 5 — seven people in half an hour, the busiest of the night.
  assert.equal(leg.arrivals_by_half_hour.length, 2);
  const counts = leg.arrivals_by_half_hour.map((b: { count: number }) => b.count);
  assert.deepEqual(counts, [4, 7]);
});

// --------------------------------------------------------------- by entrance

test("by gate: admitted, refused, ushers and the busiest window", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];

  const main = leg.by_entrance.find((e: { name: string }) => e.name === "Main Gate");
  const side = leg.by_entrance.find((e: { name: string }) => e.name === "Side Gate");

  assert.equal(main.admitted, 9, "3 + 1 + 5 through the main gate");
  assert.equal(main.refused, 2, "invalid and allowance_exhausted");
  assert.equal(main.ushers, "Musa");
  assert.ok(main.busiest_from, "a busiest window should be identified");

  assert.equal(side.admitted, 2, "manual 1 + partial 1");
  assert.equal(side.refused, 1, "wrong_event");
  assert.equal(side.ushers, "Ifeoma");

  assert.equal(
    main.admitted + side.admitted,
    leg.arrived_people,
    "gate totals must sum to arrivals",
  );
  assert.equal(main.refused + side.refused, leg.refused);
});

// ----------------------------------------------------------------- refusals

test("every refusal is listed, in order, with who and where", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];

  assert.equal(leg.refused, 3);
  assert.equal(leg.refusals.length, 3);

  const results = leg.refusals.map((r: { result: string }) => r.result);
  assert.deepEqual(results, ["wrong_event", "invalid", "allowance_exhausted"],
    "ordered by time, not by kind");

  // A refusal admits nobody — that invariant should be visible in the log.
  assert.ok(leg.refusals.every((r: { admitted_count: number }) => r.admitted_count === 0));

  const exhausted = leg.refusals.find(
    (r: { result: string }) => r.result === "allowance_exhausted",
  );
  assert.equal(exhausted.display_name, "Mr & Mrs Adeyemi");
  assert.equal(exhausted.entrance_name, "Main Gate");
  assert.equal(exhausted.staff_name, "Musa");
});

test("closed_at is the last thing that happened at the gate", async () => {
  const s = await seedNight();
  const leg = (await get(s.token, `/events/${s.event}/report`)).json().legs[0];
  // The 18:41 refusal is the final scan of the night.
  assert.equal(new Date(leg.closed_at).toISOString(), "2026-12-12T17:41:00.000Z");
});

// ---------------------------------------------------------------------- csv

test("CSV export is one row per household with an outcome for each", async () => {
  const s = await seedNight();
  const res = await get(s.token, `/events/${s.event}/report?format=csv`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /text\/csv/);
  assert.match(
    res.headers["content-disposition"] as string,
    /attachment; filename="ahmed-aisha-report\.csv"/,
  );

  const body = res.body;
  assert.ok(body.startsWith("﻿"), "a BOM keeps Excel from mangling names");

  const lines = body.trim().split("\r\n");
  assert.equal(lines.length, 8, "a header plus seven households");
  assert.ok(lines[0]!.includes('"household"'));
  assert.ok(lines[0]!.includes('"manual_check_ins"'));

  const row = (name: string) => lines.find((l) => l.includes(`"${name}"`))!;
  assert.ok(row("Mr & Mrs Adeyemi").includes('"all arrived"'));
  assert.ok(row("Emeka Balogun").includes('"partly arrived"'));
  assert.ok(row("Tunde Bakare").includes('"did not come"'));
  assert.ok(row("Ngozi Eze").includes('"declined"'));
  assert.ok(row("The Nwosu Family").includes('"over allowance"'));
  // The manual entry is attributed in the spreadsheet too.
  assert.match(row("Chidinma Okafor"), /"1"\s*$/);
});

test("CSV quoting survives a household name with a comma and a quote", async () => {
  const s = await seedNight();
  const inv = randomUUID();
  await sql`insert into invitations (id, event_id, display_name)
    values (${inv}, ${s.event}, ${'Chief, "The Lion" Obi'})`;
  await sql`insert into invitation_legs (invitation_id, leg_id, allowance)
    values (${inv}, ${s.leg}, 2)`;
  await sql`insert into passes (invitation_id, event_id) values (${inv}, ${s.event})`;

  const body = (await get(s.token, `/events/${s.event}/report?format=csv`)).body;
  assert.ok(
    body.includes('"Chief, ""The Lion"" Obi"'),
    "interior quotes must be doubled and the cell quoted",
  );
  // Still one row per household: the comma did not split a field.
  assert.equal(body.trim().split("\r\n").length, 9);
});

// -------------------------------------------------------------------- access

test("a stranger cannot read or export the report", async () => {
  const s = await seedNight();
  const other = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${other}, ${phone()}, 'Nosy')`;
  const token = app.jwt.sign({ sub: other });

  assert.equal((await get(token, `/events/${s.event}/report`)).statusCode, 403);
  assert.equal((await get(token, `/events/${s.event}/report?format=csv`)).statusCode, 403);
});

test("an event with no scans reports zeroes rather than breaking", async () => {
  const owner = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${owner}, ${phone()}, 'Fresh')`;
  const token = app.jwt.sign({ sub: owner });
  const created = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Quiet Wedding", leg: { name: "Reception", starts_at: "2027-01-01T15:00:00+01:00" } },
  });
  const event = created.json();

  const leg = (await get(token, `/events/${event.id}/report`)).json().legs[0];
  assert.equal(leg.invitations, 0);
  assert.equal(leg.arrived_people, 0);
  assert.equal(leg.no_shows, 0);
  assert.equal(leg.refused, 0);
  assert.equal(leg.closed_at, null);
  assert.deepEqual(leg.arrivals_by_half_hour, []);

  const csv = await get(token, `/events/${event.id}/report?format=csv`);
  assert.equal(csv.statusCode, 200);
  assert.equal(csv.body.trim().split("\r\n").length, 1, "header only");
});
