// Row-Level Security, tested adversarially.
//
// Every query here is written the way a BUG or an attacker would write it:
// no WHERE clause, wrong household, someone else's leg. If these pass, the
// guarantees hold in the database rather than in the care of whoever last
// edited a route.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import {
  asPass,
  asUser,
  closeDb,
  sqlAdmin,
  sqlPublic,
  sqlRw,
  sqlUsher,
  sqlVerify,
} from "./db.ts";
import { seedEvent, type Seeded } from "./testutil.ts";

const app = buildServer();
before(() => app.ready());
after(async () => {
  await app.close();
  await closeDb();
});

/** Asserts a query is refused outright, not merely filtered. */
async function refused(fn: () => Promise<unknown>, why: string) {
  await assert.rejects(fn, (err: Error & { code?: string }) => {
    // 42501 insufficient_privilege · 42P01 undefined_table
    assert.ok(
      err.code === "42501" || err.code === "42P01",
      `${why}: expected a permission error, got ${err.code} ${err.message}`,
    );
    return true;
  }, why);
}

// ---------------------------------------------------------------- fail closed

test("with no request context, every role sees nothing", async () => {
  await seedEvent(app);

  for (const [name, pool] of [
    ["app_rw", sqlRw],
    ["app_usher", sqlUsher],
  ] as const) {
    const [ev] = await pool`select count(*)::int as n from events`;
    assert.equal(ev!.n, 0, `${name} saw events with no app.user_id set`);
    const [inv] = await pool`select count(*)::int as n from invitations`;
    assert.equal(inv!.n, 0, `${name} saw invitations with no app.user_id set`);
  }

  const [pub] = await sqlPublic`select count(*)::int as n from invitations`;
  assert.equal(pub!.n, 0, "app_public saw invitations with no app.pass_id set");
});

// ------------------------------------------------------- tenant isolation

test("an organiser cannot read another organiser's guest list", async () => {
  const a = await organiserWithEvent();
  const b = await organiserWithEvent();

  // Deliberately unfiltered: exactly the bug a WHERE clause would hide.
  const seen = await asUser(sqlRw, a.userId, (db) =>
    db`select id, display_name from invitations`,
  );
  const ids = seen.map((r) => r.id);
  assert.ok(ids.includes(a.invitationId), "own household should be visible");
  assert.ok(
    !ids.includes(b.invitationId),
    "another workspace's household leaked through an unfiltered query",
  );
});

test("an organiser cannot read another organiser's check-in log or attendance", async () => {
  const a = await organiserWithEvent();
  const b = await organiserWithEvent();
  await admit(b, 2);

  const rows = await asUser(sqlRw, a.userId, (db) =>
    db`select id from check_in_events`,
  );
  assert.equal(rows.length, 0, "another event's check-ins leaked");

  const att = await asUser(sqlRw, a.userId, (db) =>
    db`select leg_id from leg_attendance`,
  );
  assert.ok(
    !att.some((r) => r.leg_id === b.legId),
    "leg_attendance leaked another event's numbers",
  );
});

test("an organiser cannot write into another organiser's event", async () => {
  const a = await organiserWithEvent();
  const b = await organiserWithEvent();

  await assert.rejects(
    () =>
      asUser(sqlRw, a.userId, (db) =>
        db`insert into invitations (event_id, display_name)
           values (${b.eventId}, 'Injected')`,
      ),
    /row-level security/,
    "wrote a household into someone else's event",
  );
});

// ------------------------------------------------------- the usher promise

test("an usher connection cannot select a guest phone number at all", async () => {
  const s = await seedEvent(app);
  await refused(
    () => asUser(sqlUsher, s.usherId, (db) => db`select primary_phone from invitations`),
    "usher read invitations.primary_phone",
  );
  await refused(
    () => asUser(sqlUsher, s.usherId, (db) => db`select primary_email from invitations`),
    "usher read invitations.primary_email",
  );
  // ...but the columns a gate needs are fine.
  const rows = await asUser(sqlUsher, s.usherId, (db) =>
    db`select display_name from invitations`,
  );
  assert.ok(rows.length > 0, "usher should still see household names");
});

test("an usher connection cannot select an event signing key", async () => {
  const s = await seedEvent(app);
  await refused(
    () => asUser(sqlUsher, s.usherId, (db) => db`select signing_key from events`),
    "usher read events.signing_key",
  );
  // The bootstrap view hands over only the keys for legs they work.
  const keys = await asUser(sqlUsher, s.usherId, (db) =>
    db`select event_id from usher_event_keys`,
  );
  assert.deepEqual(keys.map((k) => k.event_id), [s.eventId]);
});

test("an usher cannot touch the OTP table", async () => {
  const s = await seedEvent(app);
  await refused(
    () => asUser(sqlUsher, s.usherId, (db) => db`select * from auth_otp_codes`),
    "usher read auth_otp_codes",
  );
});

test("an usher on one leg cannot see another leg's guest list", async () => {
  const s = await seedEvent(app);
  // A second leg of the SAME event, with its own household — the Abuja
  // list at the Lagos gate.
  const otherLeg = randomUUID();
  const otherInv = randomUUID();
  await sqlAdmin`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${otherLeg}, ${s.eventId}, 'Traditional', 2, now())`;
  await sqlAdmin`insert into invitations (id, event_id, display_name)
    values (${otherInv}, ${s.eventId}, 'Abuja Only Family')`;
  await sqlAdmin`insert into invitation_legs (invitation_id, leg_id, allowance)
    values (${otherInv}, ${otherLeg}, 3)`;
  await sqlAdmin`insert into passes (invitation_id, event_id)
    values (${otherInv}, ${s.eventId})`;

  const list = await asUser(sqlUsher, s.usherId, (db) =>
    db`select display_name, leg_id from usher_guest_list`,
  );
  assert.ok(list.length > 0, "own leg should be visible");
  assert.ok(
    !list.some((r) => r.leg_id === otherLeg),
    "an unassigned leg's households leaked into the bootstrap view",
  );

  // invitation_legs directly, unfiltered.
  const legs = await asUser(sqlUsher, s.usherId, (db) =>
    db`select leg_id from invitation_legs`,
  );
  assert.ok(!legs.some((r) => r.leg_id === otherLeg));
});

test("an usher sees only their own assignment, not the roster", async () => {
  const s = await seedEvent(app);
  const mate = randomUUID();
  await sqlAdmin`insert into users (id, phone, full_name)
    values (${mate}, '+2348090000001', 'Other Usher')`;
  await sqlAdmin`insert into staff_assignments (user_id, leg_id)
    values (${mate}, ${s.legId})`;

  const rows = await asUser(sqlUsher, s.usherId, (db) =>
    db`select user_id from staff_assignments`,
  );
  assert.deepEqual(rows.map((r) => r.user_id), [s.usherId]);
});

test("an usher cannot attribute an admission to another usher", async () => {
  const s = await seedEvent(app);
  const mate = randomUUID();
  await sqlAdmin`insert into users (id, phone, full_name)
    values (${mate}, '+2348090000002', 'Fall Guy')`;
  await sqlAdmin`insert into staff_assignments (user_id, leg_id)
    values (${mate}, ${s.legId})`;

  await assert.rejects(
    () =>
      asUser(sqlUsher, s.usherId, (db) =>
        db`insert into check_in_events
             (client_uuid, event_id, leg_id, pass_id, staff_user_id,
              result, admitted_count, occupancy_delta, scanned_at)
           values (${randomUUID()}, ${s.eventId}, ${s.legId}, ${s.passId},
              ${mate}, 'admitted', 1, 1, now())`,
      ),
    /row-level security/,
    "forged an admission under another usher's name",
  );
});

test("no application role may rewrite the check-in log", async () => {
  const s = await seedEvent(app);
  await admitVia(s, 2);

  // A scanner has no grant at all on either verb — the first lock.
  await refused(
    () => asUser(sqlUsher, s.usherId, (db) => db`update check_in_events set admitted_count = 99`),
    "usher updated check_in_events",
  );
  await refused(
    () => asUser(sqlUsher, s.usherId, (db) => db`delete from check_in_events`),
    "usher deleted check_in_events",
  );

  // No role anywhere holds UPDATE on this table, so an admission can never
  // be rewritten — the grant settles it before the trigger is consulted.
  await refused(
    () => asUser(sqlRw, s.usherId, (db) => db`update check_in_events set admitted_count = 99`),
    "app_rw rewrote history",
  );

  // app_rw DOES hold delete, so a whole event can be erased when the
  // organiser asks for it (db/migrations/006). The trigger is what keeps
  // that narrow: a delete is refused unless the transaction has named the
  // event it is erasing, so no single scan can be quietly dropped.
  //
  // This has to run as someone who genuinely MANAGES the event. As anyone
  // else, RLS filters the delete to zero rows and it "succeeds" without
  // touching anything — which proves nothing about the trigger.
  const o = await organiserWithEvent();
  await admit(o, 2);
  await assert.rejects(
    () => asUser(sqlRw, o.userId, (db) => db`delete from check_in_events`),
    /append-only/,
    "app_rw deleted a scan without naming an event to erase",
  );
  const [survived] = await sqlAdmin`
    select count(*)::int as n from check_in_events where event_id = ${o.eventId}`;
  assert.equal(survived!.n, 1, "the scan must still be there");
});

// -------------------------------------------------------- the guest promise

test("a guest page scoped to one pass cannot read another household", async () => {
  const s = await seedEvent(app);

  const rows = await asPass(s.passId, (db) =>
    db`select id, display_name from invitations`,
  );
  assert.equal(rows.length, 1, "a guest page saw more than one household");
  assert.equal(rows[0]!.display_name, "Mr & Mrs Adeyemi");

  const legs = await asPass(s.passId, (db) => db`select invitation_id from invitation_legs`);
  assert.ok(legs.every((r) => r.invitation_id === s.invitationId));
});

test("a guest page cannot read phones, keys, staff or check-ins", async () => {
  const s = await seedEvent(app);
  await refused(
    () => asPass(s.passId, (db) => db`select primary_phone from invitations`),
    "guest read primary_phone",
  );
  await refused(
    () => asPass(s.passId, (db) => db`select signing_key from events`),
    "guest read a signing key",
  );
  await refused(
    () => asPass(s.passId, (db) => db`select * from staff_assignments`),
    "guest read the staff roster",
  );
  await refused(
    () => asPass(s.passId, (db) => db`select * from check_in_events`),
    "guest read the check-in log",
  );
});

test("a guest page cannot change anything but its own reply", async () => {
  const s = await seedEvent(app);
  const other = await seedEvent(app);

  // Its own RSVP: allowed.
  await asPass(s.passId, (db) =>
    db`update invitation_legs set rsvp = 'attending', rsvp_count = 4
       where invitation_id = ${s.invitationId}`,
  );
  const [own] = await sqlAdmin`
    select rsvp from invitation_legs where invitation_id = ${s.invitationId}`;
  assert.equal(own!.rsvp, "attending");

  // Someone else's: silently matches nothing, and stays untouched.
  await asPass(s.passId, (db) =>
    db`update invitation_legs set rsvp = 'declined'
       where invitation_id = ${other.invitationId}`,
  );
  const [theirs] = await sqlAdmin`
    select rsvp from invitation_legs where invitation_id = ${other.invitationId}`;
  assert.equal(theirs!.rsvp, "pending", "a guest changed another household's reply");

  // Its own allowance: not a thing a guest may raise.
  await refused(
    () => asPass(s.passId, (db) => db`update invitations set display_name = 'Hacked'`),
    "guest renamed their household",
  );
});

test("a revoked pass loses guest access immediately", async () => {
  const s = await seedEvent(app);
  await sqlAdmin`update passes set status = 'revoked' where id = ${s.passId}`;
  const rows = await asPass(s.passId, (db) => db`select id from invitations`);
  assert.equal(rows.length, 0, "a revoked pass still reached its household");
});

// ----------------------------------------------------------- the verifier

test("the verifier reads keys and nothing else", async () => {
  await seedEvent(app);
  const keys = await sqlVerify`select signing_key from events`;
  assert.ok(keys.length > 0, "verifier should read signing keys");

  for (const table of [
    "invitations",
    "passes",
    "check_in_events",
    "staff_assignments",
    "auth_otp_codes",
    "users",
  ]) {
    await refused(
      () => sqlVerify`select * from ${sqlVerify(table)}`,
      `verifier read ${table}`,
    );
  }
});

// ------------------------------------------------------------------ helpers

type Org = {
  userId: string;
  eventId: string;
  legId: string;
  invitationId: string;
  passId: string;
};

/** An organiser with their own workspace, event, leg and one household. */
async function organiserWithEvent(): Promise<Org> {
  const userId = randomUUID();
  const wsId = randomUUID();
  const eventId = randomUUID();
  const legId = randomUUID();
  const invitationId = randomUUID();
  const passId = randomUUID();
  const phone = `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

  await sqlAdmin`insert into users (id, phone, full_name)
    values (${userId}, ${phone}, 'Organiser')`;
  await sqlAdmin`insert into workspaces (id, name, owner_user_id)
    values (${wsId}, 'WS', ${userId})`;
  await sqlAdmin`insert into events (id, workspace_id, name, signing_key, status)
    values (${eventId}, ${wsId}, 'Wedding', gen_random_bytes(32), 'active')`;
  await sqlAdmin`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legId}, ${eventId}, 'Main', 1, now())`;
  await sqlAdmin`insert into invitations (id, event_id, display_name, primary_phone)
    values (${invitationId}, ${eventId}, 'Their Household', ${phone})`;
  await sqlAdmin`insert into invitation_legs (invitation_id, leg_id, allowance)
    values (${invitationId}, ${legId}, 4)`;
  await sqlAdmin`insert into passes (id, invitation_id, event_id)
    values (${passId}, ${invitationId}, ${eventId})`;
  return { userId, eventId, legId, invitationId, passId };
}

/** Land an admission with the superuser handle (fixture, not under test). */
async function admit(o: Org, count: number): Promise<void> {
  await sqlAdmin`insert into check_in_events
      (client_uuid, event_id, leg_id, pass_id, invitation_id, staff_user_id,
       result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${o.eventId}, ${o.legId}, ${o.passId},
       ${o.invitationId}, ${o.userId}, 'partial', ${count}, ${count}, now())`;
}

async function admitVia(s: Seeded, count: number): Promise<void> {
  await sqlAdmin`insert into check_in_events
      (client_uuid, event_id, leg_id, pass_id, invitation_id, staff_user_id,
       result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${s.eventId}, ${s.legId}, ${s.passId},
       ${s.invitationId}, ${s.usherId}, 'partial', ${count}, ${count}, now())`;
}
