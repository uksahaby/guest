// Organiser API: events, guest list, delivery links, attendance.
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sql } from "./db.ts";

const app = buildServer();
before(() => app.ready());
after(async () => {
  await app.close();
  await sql.end();
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
