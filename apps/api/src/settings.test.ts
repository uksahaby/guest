// Event settings, and the three things under "Careful".
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
    leg: {
      name: "Reception",
      starts_at: "2026-12-12T16:00:00+01:00",
      venue_name: "Oriental Hotel",
    },
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
  return res.json().id as string;
}

// ------------------------------------------------------------------ reading

test("settings carry the numbers each toggle would cost", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  // Two households who never replied, one who did.
  await household(o.token, event.id, legId, "Silent One", 4);
  await household(o.token, event.id, legId, "Silent Two", 2);
  const replied = await household(o.token, event.id, legId, "Replied", 3);
  await sql`update invitation_legs set rsvp = 'attending', rsvp_count = 3
    where invitation_id = ${replied}`;

  const res = await call(o.token, "GET", `/events/${event.id}/settings`);
  assert.equal(res.statusCode, 200);
  const s = res.json();

  assert.equal(s.allow_overflow, true, "warn-and-allow is the default");
  assert.equal(s.require_rsvp, false, "gating on RSVP is off by default");
  assert.equal(s.allow_walkins, true);
  assert.equal(s.allow_usher_undo, true);

  // The figures behind the mockup's sentences.
  assert.equal(s.consequences.never_replied_households, 2);
  assert.equal(
    s.consequences.never_replied_people,
    6,
    "6 people would be stopped at the gate if RSVP were required",
  );
  assert.equal(s.consequences.active_passes, 3);
  assert.equal(s.consequences.overflow_parties, 0);
  assert.equal(s.consequences.scans_recorded, 0);
  assert.equal(s.legs[0].venue_name, "Oriental Hotel");
});

test("overflow already used is reported as parties and people", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const inv = await household(o.token, event.id, legId, "The Nwosu Family", 4);
  const [pass] = await sql`select id from passes where invitation_id = ${inv}`;
  const usher = await organiser();
  await sql`insert into staff_assignments (user_id, leg_id) values (${usher.id}, ${legId})`;
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, pass_id, invitation_id, staff_user_id,
       result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${event.id}, ${legId}, ${pass!.id}, ${inv}, ${usher.id},
       'overflow_admitted', 6, 6, now())`;

  const s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();
  assert.equal(s.consequences.overflow_parties, 1);
  assert.equal(s.consequences.overflow_people, 2);
  assert.equal(s.consequences.scans_recorded, 1);
});

// ------------------------------------------------------------------ editing

test("a toggle changes only itself", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const res = await call(o.token, "PATCH", `/events/${event.id}`, {
    require_rsvp: true,
  });
  assert.equal(res.statusCode, 200);
  const after = res.json();
  assert.equal(after.require_rsvp, true);
  // The four fields the form didn't post must be untouched.
  assert.equal(after.allow_overflow, true);
  assert.equal(after.allow_walkins, true);
  assert.equal(after.allow_usher_undo, true);
  assert.equal(after.name, "Ahmed & Aisha");
});

test("the gate policy reaches the scanner's bootstrap", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const usher = await organiser();
  await sql`insert into staff_assignments (user_id, leg_id) values (${usher.id}, ${legId})`;

  await call(o.token, "PATCH", `/events/${event.id}`, {
    allow_overflow: false,
    require_rsvp: true,
    allow_walkins: false,
  });

  const boot = (await call(usher.token, "GET", `/scanner/legs/${legId}/bootstrap`)).json();
  assert.equal(boot.event.allow_overflow, false);
  assert.equal(boot.event.require_rsvp, true);
  assert.equal(boot.event.allow_walkins, false);
});

test("the reply deadline can be set and cleared", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const set = await call(o.token, "PATCH", `/events/${event.id}`, {
    rsvp_deadline: "2026-12-01",
  });
  assert.match(set.json().rsvp_deadline, /^2026-12-01/);

  // Omitting it leaves it alone…
  const untouched = await call(o.token, "PATCH", `/events/${event.id}`, { name: "Same" });
  assert.match(untouched.json().rsvp_deadline, /^2026-12-01/);

  // …but an explicit null clears it.
  const cleared = await call(o.token, "PATCH", `/events/${event.id}`, {
    rsvp_deadline: null,
  });
  assert.equal(cleared.json().rsvp_deadline, null);
});

test("nonsense names and statuses are refused", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  assert.equal(
    (await call(o.token, "PATCH", `/events/${event.id}`, { name: "   " })).json().code,
    "bad_name",
  );
  assert.equal(
    (await call(o.token, "PATCH", `/events/${event.id}`, { status: "married" })).json().code,
    "bad_status",
  );
});

test("changing the date or venue updates the guest's page immediately", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  const link = (
    await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
      invitation_ids: [inv],
    })
  ).json()[0];
  const token = link.invite_url.split("/i/")[1];

  const before = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(before.json().legs[0].venue_name, "Oriental Hotel");

  await call(o.token, "PATCH", `/legs/${legId}`, {
    venue_name: "Eko Hotel",
    starts_at: "2026-12-13T17:00:00+01:00",
  });

  const after = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(after.json().legs[0].venue_name, "Eko Hotel");
  assert.match(after.json().legs[0].starts_at, /^2026-12-13/);
});

// ------------------------------------------------------------------ careful

test("reissuing passes kills every existing link at once", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  const link = (
    await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
      invitation_ids: [inv],
    })
  ).json()[0];
  const oldToken = link.invite_url.split("/i/")[1];

  // It works before…
  assert.equal(
    (await app.inject({ method: "GET", url: `/public/invitations/${oldToken}` })).statusCode,
    200,
  );

  const res = await call(o.token, "POST", `/events/${event.id}/reissue-passes`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().token_version, 2);
  assert.equal(res.json().passes_reissued, 1);

  // …and is dead after. One integer, no revocation list.
  assert.equal(
    (await app.inject({ method: "GET", url: `/public/invitations/${oldToken}` })).statusCode,
    404,
  );

  // A freshly generated link works again.
  const newLink = (
    await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
      invitation_ids: [inv],
    })
  ).json()[0];
  const newToken = newLink.invite_url.split("/i/")[1];
  assert.notEqual(newToken, oldToken);
  assert.equal(
    (await app.inject({ method: "GET", url: `/public/invitations/${newToken}` })).statusCode,
    200,
  );
});

test("cancelling keeps the data and the history", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  const [pass] = await sql`select id from passes where invitation_id = ${inv}`;
  const usher = await organiser();
  await sql`insert into staff_assignments (user_id, leg_id) values (${usher.id}, ${legId})`;
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, pass_id, invitation_id, staff_user_id,
       result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${event.id}, ${legId}, ${pass!.id}, ${inv}, ${usher.id},
       'admitted', 4, 4, now())`;

  const res = await call(o.token, "PATCH", `/events/${event.id}`, {
    status: "cancelled",
  });
  assert.equal(res.json().status, "cancelled");

  const [rows] = await sql`
    select count(*)::int as n from check_in_events where event_id = ${event.id}`;
  assert.equal(rows!.n, 1, "cancelling is not erasing");
  const [invs] = await sql`
    select count(*)::int as n from invitations where event_id = ${event.id}`;
  assert.equal(invs!.n, 1);
});

test("deleting an event removes it, history and all", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  const [pass] = await sql`select id from passes where invitation_id = ${inv}`;
  const usher = await organiser();
  await sql`insert into staff_assignments (user_id, leg_id) values (${usher.id}, ${legId})`;
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, pass_id, invitation_id, staff_user_id,
       result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${event.id}, ${legId}, ${pass!.id}, ${inv}, ${usher.id},
       'admitted', 4, 4, now())`;

  // The public FAQ promises this is possible, and the append-only trigger
  // used to make it impossible.
  const res = await call(o.token, "DELETE", `/events/${event.id}`);
  assert.equal(res.statusCode, 204);

  for (const table of ["events", "invitations", "passes", "check_in_events"]) {
    const [row] = await sql`
      select count(*)::int as n from ${sql(table)}
      where ${sql(table === "events" ? "id" : "event_id")} = ${event.id}`;
    assert.equal(row!.n, 0, `${table} should be gone`);
  }
});

test("the append-only log still refuses everything else", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;
  const inv = await household(o.token, event.id, legId, "Mr & Mrs Adeyemi", 4);
  const [pass] = await sql`select id from passes where invitation_id = ${inv}`;
  const usher = await organiser();
  await sql`insert into staff_assignments (user_id, leg_id) values (${usher.id}, ${legId})`;
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, pass_id, invitation_id, staff_user_id,
       result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${event.id}, ${legId}, ${pass!.id}, ${inv}, ${usher.id},
       'admitted', 4, 4, now())`;

  // One embarrassing scan cannot be quietly removed…
  await assert.rejects(
    () => sql`delete from check_in_events where event_id = ${event.id}`,
    /append-only/,
  );
  // …and an UPDATE is refused even while an erasure is in flight.
  await assert.rejects(
    () =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.erasing_event', ${event.id}, true)`;
        await tx`update check_in_events set admitted_count = 99
                 where event_id = ${event.id}`;
      }),
    /append-only/,
  );
});

// ------------------------------------------------------------------- access

test("a stranger can neither read nor change settings", async () => {
  const o = await organiser();
  const stranger = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  assert.equal(
    (await call(stranger.token, "GET", `/events/${event.id}/settings`)).statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "PATCH", `/events/${event.id}`, { require_rsvp: true }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "PATCH", `/legs/${legId}`, { venue_name: "Mine" })).statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "POST", `/events/${event.id}/reissue-passes`)).statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "DELETE", `/events/${event.id}`)).statusCode,
    403,
  );

  // Nothing moved.
  const s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();
  assert.equal(s.require_rsvp, false);
  assert.equal(s.token_version, 1);
  assert.equal(s.legs[0].venue_name, "Oriental Hotel");
});

// ---- the fields the settings screen added (db/migrations/017) ------------

test("a fresh event reads with the defaults the schema promises", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();

  assert.equal(s.timezone, "Africa/Lagos");
  assert.deepEqual(s.tags, []);
  assert.equal(s.end_date, null);
  assert.equal(s.slug, null);
  // The two that are policy: a pass is the only way in, and nothing is
  // public until somebody says so.
  assert.equal(s.invitation_only, true);
  assert.equal(s.public_page, false);
  assert.equal(s.legs[0].all_day, false);
  assert.ok(s.event_types.includes("wedding"));
});

test("the details the mockup asks for all save and read back", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const res = await call(o.token, "PATCH", `/events/${event.id}`, {
    event_type: "engagement",
    description: "Join us as we celebrate the union of Ahmed and Aisha.",
    end_date: "2026-12-13",
    timezone: "Africa/Lagos",
    tags: ["Wedding", "Reception", "Family Event"],
    public_page: true,
    invitation_only: false,
  });
  assert.equal(res.statusCode, 200);

  const s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();
  assert.equal(s.event_type, "engagement");
  assert.match(s.description, /^Join us as we celebrate/);
  assert.equal(s.end_date.slice(0, 10), "2026-12-13");
  assert.deepEqual(s.tags, ["Wedding", "Reception", "Family Event"]);
  assert.equal(s.public_page, true);
  assert.equal(s.invitation_only, false);
});

test("an omitted field is left alone; an empty one is cleared", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  await call(o.token, "PATCH", `/events/${event.id}`, {
    description: "Aso-ebi is emerald and gold.",
    end_date: "2026-12-13",
  });
  // A save from another tab that names neither must not blank them.
  await call(o.token, "PATCH", `/events/${event.id}`, { require_rsvp: true });
  let s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();
  assert.equal(s.description, "Aso-ebi is emerald and gold.");
  assert.ok(s.end_date);

  // Explicitly empty is a real instruction, and a different one.
  await call(o.token, "PATCH", `/events/${event.id}`, { description: "", end_date: "" });
  s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();
  assert.equal(s.description, null);
  assert.equal(s.end_date, null);
});

test("a custom link is claimed once, and refused to the next event", async () => {
  const o = await organiser();
  const mine = await newEvent(o.token);
  const other = await newEvent(o.token);

  assert.equal(
    (await call(o.token, "PATCH", `/events/${mine.id}`, { slug: "Ahmed-Aisha-2025" }))
      .statusCode,
    200,
  );
  // Lowercased on the way in — a link is read aloud, not typed exactly.
  let s = (await call(o.token, "GET", `/events/${mine.id}/settings`)).json();
  assert.equal(s.slug, "ahmed-aisha-2025");

  const clash = await call(o.token, "PATCH", `/events/${other.id}`, {
    slug: "ahmed-aisha-2025",
  });
  assert.equal(clash.statusCode, 409);
  assert.equal(clash.json().code, "slug_taken");

  // Re-saving your own link is not a clash with yourself.
  assert.equal(
    (await call(o.token, "PATCH", `/events/${mine.id}`, { slug: "ahmed-aisha-2025" }))
      .statusCode,
    200,
  );

  // And it can be given up.
  await call(o.token, "PATCH", `/events/${mine.id}`, { slug: "" });
  s = (await call(o.token, "GET", `/events/${mine.id}/settings`)).json();
  assert.equal(s.slug, null);
});

test("nonsense is refused with a sentence, not a 500", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const bad = async (body: unknown, code: string) => {
    const res = await call(o.token, "PATCH", `/events/${event.id}`, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.json().code, code);
  };

  await bad({ event_type: "coronation" }, "bad_event_type");
  await bad({ description: "x".repeat(251) }, "bad_description");
  await bad({ end_date: "the twelfth" }, "bad_end_date");
  await bad({ timezone: "Africa/Lagoon" }, "bad_timezone");
  await bad({ tags: ["ok", "x".repeat(25)] }, "bad_tags");
  await bad({ tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, "bad_tags");
  // A path the site already owns would be a link that never arrives.
  await bad({ slug: "login" }, "bad_slug");
  await bad({ slug: "Not A Slug" }, "bad_slug");
});

test("a leg can run all day, and says so afterwards", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const res = await call(o.token, "PATCH", `/legs/${legId}`, {
    all_day: true,
    doors_close_at: "2026-12-12T23:00:00+01:00",
    address_line: "123 Celebration Avenue, Victoria Island, Lagos",
  });
  assert.equal(res.statusCode, 200);

  const s = (await call(o.token, "GET", `/events/${event.id}/settings`)).json();
  assert.equal(s.legs[0].all_day, true);
  assert.ok(s.legs[0].doors_close_at);
  assert.match(s.legs[0].address_line, /Celebration Avenue/);
});
