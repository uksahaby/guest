// Organiser API: events, guest list, delivery links, attendance.
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

async function organiser(): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${id}, ${phone()}, 'Ahmed')`;
  return { id, token: app.jwt.sign({ sub: id }) };
}

function call(
  token: string,
  method: "GET" | "POST",
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

async function createEvent(token: string) {
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

test("creating an event creates its leg in the same transaction", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);

  assert.equal(event.name, "Ahmed & Aisha");
  assert.equal(event.plan, "free");
  assert.equal(event.people_limit, 150);
  assert.equal(event.legs.length, 1);
  assert.equal(event.legs[0].name, "Reception");
  assert.equal(event.legs[0].sequence, 1);

  // The implicit workspace was created silently.
  const [ws] = await sql`
    select is_implicit, name from workspaces
    where owner_user_id = ${o.id}`;
  assert.equal(ws!.is_implicit, true);
  assert.equal(ws!.name, "Ahmed");
});

test("events are invisible to strangers", async () => {
  const owner = await organiser();
  const stranger = await organiser();
  const event = await createEvent(owner.token);

  assert.equal(
    (await call(stranger.token, "GET", `/events/${event.id}`)).statusCode,
    403,
  );
  const list = (await call(stranger.token, "GET", "/events")).json();
  assert.equal(list.length, 0);
});

test("an event_manager member sees the event; an usher does not", async () => {
  const owner = await organiser();
  const manager = await organiser();
  const usher = await organiser();
  const event = await createEvent(owner.token);

  const [ws] = await sql`select workspace_id from events where id = ${event.id}`;
  await sql`insert into workspace_memberships (workspace_id, user_id, role) values
    (${ws!.workspace_id}, ${manager.id}, 'event_manager'),
    (${ws!.workspace_id}, ${usher.id}, 'usher')`;

  assert.equal((await call(manager.token, "GET", `/events/${event.id}`)).statusCode, 200);
  assert.equal((await call(usher.token, "GET", `/events/${event.id}`)).statusCode, 403);
});

test("adding a household issues its pass immediately — before any RSVP", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);

  const res = await call(o.token, "POST", `/events/${event.id}/invitations`, {
    display_name: "Mr & Mrs Adeyemi",
    primary_phone: "+2348034112098",
    legs: [{ leg_id: event.legs[0].id, allowance: 4 }],
  });
  assert.equal(res.statusCode, 201);
  const { id } = res.json();

  const [pass] = await sql`select status from passes where invitation_id = ${id}`;
  assert.equal(pass!.status, "active");
});

test("an unnamed household with an allowance is complete and valid", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);
  await call(o.token, "POST", `/events/${event.id}/invitations`, {
    display_name: "The Nwosu Family",
    legs: [{ leg_id: event.legs[0].id, allowance: 6 }],
  });

  const list = (await call(o.token, "GET", `/events/${event.id}/invitations`)).json();
  const nwosu = list.data.find(
    (i: { display_name: string }) => i.display_name === "The Nwosu Family",
  );
  assert.equal(nwosu.named_count, 0);
  assert.equal(nwosu.legs[0].allowance, 6);
  assert.equal(nwosu.legs[0].admitted, 0);
  assert.equal(nwosu.delivery_state, "not_sent");
});

test("delivery links: wa.me URL, working invite URL, state moves", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);
  const inv = (
    await call(o.token, "POST", `/events/${event.id}/invitations`, {
      display_name: "Mr & Mrs Adeyemi",
      primary_phone: "+2348034112098",
      legs: [{ leg_id: event.legs[0].id, allowance: 4 }],
    })
  ).json();

  const res = await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
    invitation_ids: [inv.id],
  });
  assert.equal(res.statusCode, 200);
  const [link] = res.json();

  assert.ok(link.whatsapp_url.startsWith("https://wa.me/2348034112098?text="));
  assert.match(link.message, /Mr & Mrs Adeyemi/);
  assert.match(link.message, /Ahmed & Aisha/);
  assert.ok(link.invite_url.includes("/i/"));

  // The invite URL's token is genuinely live on the public endpoint.
  const token = link.invite_url.split("/i/")[1];
  const guest = await app.inject({ method: "GET", url: `/public/invitations/${token}` });
  assert.equal(guest.statusCode, 200);
  assert.equal(guest.json().display_name, "Mr & Mrs Adeyemi");

  // link_generated → opened when the household visits.
  const list = (await call(o.token, "GET", `/events/${event.id}/invitations`)).json();
  assert.equal(list.data[0].delivery_state, "opened");
});

test("the paywall sits on sending, never on storing", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);
  await sql`update events set people_limit = 6 where id = ${event.id}`;

  // Importing 3 households of 4 (12 people) on a 6-person plan: free.
  const ids: string[] = [];
  for (let n = 0; n < 3; n++) {
    const r = await call(o.token, "POST", `/events/${event.id}/invitations`, {
      display_name: `Household ${n}`,
      primary_phone: phone(),
      legs: [{ leg_id: event.legs[0].id, allowance: 4 }],
    });
    assert.equal(r.statusCode, 201, "storing must never hit the limit");
    ids.push(r.json().id);
  }

  // Sending the first household (4 of 6): fine.
  const first = await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
    invitation_ids: [ids[0]],
  });
  assert.equal(first.statusCode, 200);

  // Sending the second (8 of 6): the billing gate.
  const second = await call(o.token, "POST", `/events/${event.id}/delivery-links`, {
    invitation_ids: [ids[1]],
  });
  assert.equal(second.statusCode, 402);
  assert.equal(second.json().code, "limit_reached");
});

test("attendance endpoint mirrors the leg_attendance view", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);
  const legId = event.legs[0].id;
  await call(o.token, "POST", `/events/${event.id}/invitations`, {
    display_name: "Mr & Mrs Adeyemi",
    legs: [{ leg_id: legId, allowance: 4 }],
  });

  const res = await call(o.token, "GET", `/legs/${legId}/attendance`);
  assert.equal(res.statusCode, 200);
  const a = res.json();
  assert.equal(a.invitations, 1);
  assert.equal(a.invited_people, 4);
  assert.equal(a.arrived_people, 0);
  assert.equal(a.refused, 0);
});

// ---------------------------------------------------------------- guest list
//
// delivery_state used to be max(state::text), which ranks 'sent' above
// 'opened' because s sorts after o. Anyone who had opened their invitation
// was reported as merely sent — and the guest list derives "pending" (needs
// a nudge) from "opened", so the badge contradicted the count beside it.

test("a household that opened its invitation reads as opened, not sent", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);

  const [inv] = await sql`
    insert into invitations (event_id, display_name)
    values (${event.id}, 'Mr & Mrs Opened') returning id`;
  await sql`
    insert into invitation_legs (invitation_id, leg_id, allowance)
    values (${inv!.id}, ${event.legs[0].id}, 2)`;

  // Two rows, as a real send produces: the link, then the open.
  await sql`
    insert into invitation_deliveries
      (invitation_id, channel, state, generated_at, sent_at)
    values (${inv!.id}, 'whatsapp_link', 'sent', now(), now())`;
  await sql`
    insert into invitation_deliveries
      (invitation_id, channel, state, generated_at, sent_at, opened_at)
    values (${inv!.id}, 'whatsapp_link', 'opened', now(), now(), now())`;

  const res = await app.inject({
    method: "GET",
    url: `/events/${event.id}/invitations`,
    headers: { authorization: `Bearer ${o.token}` },
  });
  const row = res.json().data.find((r: { id: string }) => r.id === inv!.id);
  assert.equal(row.delivery_state, "opened");
});

test("the guest list paginates and reports a total", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);

  for (let i = 0; i < 5; i++) {
    const [inv] = await sql`
      insert into invitations (event_id, display_name)
      values (${event.id}, ${`Household ${i}`}) returning id`;
    await sql`
      insert into invitation_legs (invitation_id, leg_id, allowance)
      values (${inv!.id}, ${event.legs[0].id}, 2)`;
  }

  const res = await app.inject({
    method: "GET",
    url: `/events/${event.id}/invitations?limit=2&offset=2`,
    headers: { authorization: `Bearer ${o.token}` },
  });
  const body = res.json();

  assert.equal(body.total, 5, "the total counts the list, not the page");
  assert.equal(body.data.length, 2);
  assert.equal(body.counts.households, 5);
  assert.equal(body.counts.people, 10);
});

test("filtering by RSVP narrows the rows but not the counts", async () => {
  const o = await organiser();
  const event = await createEvent(o.token);

  for (const [name, rsvp] of [
    ["Mr Yes", "attending"],
    ["Mr No", "declined"],
    ["Mr Quiet", "pending"],
  ] as const) {
    const [inv] = await sql`
      insert into invitations (event_id, display_name)
      values (${event.id}, ${name}) returning id`;
    await sql`
      insert into invitation_legs (invitation_id, leg_id, allowance, rsvp, rsvp_count)
      values (${inv!.id}, ${event.legs[0].id}, 2, ${rsvp}::rsvp_status,
              ${rsvp === "attending" ? 2 : null})`;
  }

  const res = await app.inject({
    method: "GET",
    url: `/events/${event.id}/invitations?rsvp=confirmed`,
    headers: { authorization: `Bearer ${o.token}` },
  });
  const body = res.json();

  assert.equal(body.data.length, 1, "one confirmed household");
  assert.equal(body.total, 1);
  // The cards are the filters, so their numbers must describe the whole
  // event — otherwise clicking one changes what the others claim.
  assert.equal(body.counts.households, 3);
  assert.equal(body.counts.confirmed, 1);
  assert.equal(body.counts.declined, 1);
  assert.equal(body.counts.no_response, 1, "never opened, so not 'pending'");
});
