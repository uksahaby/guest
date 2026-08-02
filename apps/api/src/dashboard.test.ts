// The organiser's home screen.
//
// Most of this file tests readiness(), which is pure and encodes
// spec/event-readiness-rules.md. That spec makes two arguments worth
// holding onto in tests rather than trusting to memory: a check must stay
// hidden until it starts mattering, and the headline is a word rather than
// a percentage — because "82% ready" tells nobody what to do.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { readiness } from "./dashboard.ts";

const app = buildServer();
before(() => app.ready());
after(async () => {
  await app.close();
  await closeDb();
});

/** A perfectly prepared event. Every check passes. */
const ready = {
  eventId: "e1",
  hasDetails: true,
  invitations: 100,
  linked: 100,
  replied: 100,
  unassigned: 0,
  usesTables: true,
  entrances: 2,
  staff: 3,
  testScans: 1,
  passes: 100,
  peopleLimit: 150,
};

// ---------------------------------------------------------------- windows

test("a check stays hidden until it starts mattering", () => {
  const nothingSent = { ...ready, linked: 0 };

  // Check 3 starts mattering 6 weeks out. Ten weeks out, an organiser who
  // has sent nothing is not behind — they are early.
  assert.equal(readiness(70, nothingSent).items.length, 0);

  // Inside the window it appears, and says what and how many.
  const inWindow = readiness(30, nothingSent).items;
  assert.equal(inWindow.length, 1);
  assert.match(inWindow[0]!.fact, /100 households have no invitation link/);
  assert.equal(inWindow[0]!.action, "Send invitations");
});

test("past its urgent point a check is flagged, not just listed", () => {
  const nothingSent = { ...ready, linked: 0 };
  assert.equal(readiness(30, nothingSent).items[0]!.urgent, false);
  // Urgent at 3 weeks.
  assert.equal(readiness(14, nothingSent).items[0]!.urgent, true);
});

test("the urgent ones sort above the rest", () => {
  const messy = { ...ready, linked: 0, testScans: 0 };
  // Two days out: check 8 (urgent at 1 day) is not yet urgent, check 3 is.
  const items = readiness(2, messy).items;
  assert.equal(items[0]!.check, 3, "the urgent one leads");
  assert.equal(items[0]!.urgent, true);
});

// ------------------------------------------------------------ the headline

test("the headline is a word, never a percentage", () => {
  const { state } = readiness(30, ready);
  assert.equal(typeof state, "string");
  assert.equal(state, "on_track");
});

test("an event with no guests is still setting up", () => {
  assert.equal(readiness(60, { ...ready, invitations: 0 }).state, "setting_up");
});

test("a missing date or venue is setting up, however close it is", () => {
  assert.equal(readiness(2, { ...ready, hasDetails: false }).state, "setting_up");
});

test("one urgent failure makes the whole event need attention", () => {
  assert.equal(readiness(1, { ...ready, testScans: 0 }).state, "needs_attention");
});

test("ready is only claimed inside the last week", () => {
  assert.equal(readiness(30, ready).state, "on_track", "a month out is not ready");
  assert.equal(readiness(3, ready).state, "ready");
});

test("after the day it is complete, whatever was outstanding", () => {
  assert.equal(readiness(-1, { ...ready, testScans: 0 }).state, "complete");
});

// ------------------------------------------------------------- feature off

test("tables are not nagged about when the event does not use them", () => {
  const noTables = { ...ready, usesTables: false, unassigned: 12 };
  assert.equal(readiness(5, noTables).items.length, 0);
});

// -------------------------------------------------------------- the route

async function organiser() {
  const id = randomUUID();
  const phone = `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
  await sql`insert into users (id, phone, full_name)
            values (${id}, ${phone}, 'Khalid Salami')`;
  return { id, token: app.jwt.sign({ sub: id }) };
}

test("a brand new organiser gets an empty dashboard, not an error", async () => {
  const o = await organiser();
  const res = await app.inject({
    method: "GET",
    url: "/dashboard",
    headers: { authorization: `Bearer ${o.token}` },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.featured, null, "nothing to feature yet");
  assert.deepEqual(body.events, []);
  assert.equal(body.organiser, "Khalid Salami", "the greeting needs a name");
});

test("the dashboard needs a session", async () => {
  const res = await app.inject({ method: "GET", url: "/dashboard" });
  assert.equal(res.statusCode, 401);
});

test("one event, and it becomes the featured one with its real numbers", async () => {
  const o = await organiser();
  const created = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${o.token}` },
    payload: {
      name: "Ahmed & Aisha",
      leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
    },
  });
  assert.equal(created.statusCode, 201);

  const res = await app.inject({
    method: "GET",
    url: "/dashboard",
    headers: { authorization: `Bearer ${o.token}` },
  });
  const body = res.json();

  assert.equal(body.featured.name, "Ahmed & Aisha");
  assert.equal(body.events.length, 1, "the switcher needs the list");
  assert.equal(body.totals.invitations, 0);
  assert.equal(body.totals.arrived_people, 0);
  assert.equal(body.rsvp.total, 0);
  assert.equal(body.readiness.state, "setting_up", "no guests yet");
  assert.deepEqual(body.activity, [], "nothing has happened yet");
});
