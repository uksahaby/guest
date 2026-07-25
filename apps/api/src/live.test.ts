// The live feed. The one that matters is "a scan reaches an open stream" —
// everything else is counters.
//
// testdb must be imported before anything that touches db.ts.
import "./testdb.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildServer } from "./server.ts";
import { sqlAdmin as sql, closeDb } from "./db.ts";
import { watcherCount } from "./live.ts";

const app = buildServer();
let baseUrl = "";

before(async () => {
  await app.ready();
  // A real socket: reply.hijack() means inject() can't see the stream.
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
after(async () => {
  await app.close();
  await closeDb();
});

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

async function seedLeg() {
  const owner = randomUUID(), usher = randomUUID();
  const ws = randomUUID(), event = randomUUID(), leg = randomUUID();
  const gate = randomUUID(), inv = randomUUID(), pass = randomUUID();

  await sql`insert into users (id, phone, full_name) values
    (${owner}, ${phone()}, 'Ahmed'), (${usher}, ${phone()}, 'Musa')`;
  await sql`insert into workspaces (id, name, owner_user_id) values (${ws}, 'WS', ${owner})`;
  await sql`insert into events (id, workspace_id, name, signing_key, status)
    values (${event}, ${ws}, 'Ahmed & Aisha', gen_random_bytes(32), 'active')`;
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${leg}, ${event}, 'Reception', 1, now())`;
  await sql`insert into entrances (id, leg_id, name) values (${gate}, ${leg}, 'Main Gate')`;
  await sql`insert into staff_assignments (user_id, leg_id, entrance_id)
    values (${usher}, ${leg}, ${gate})`;
  await sql`insert into invitations (id, event_id, display_name)
    values (${inv}, ${event}, 'Mr & Mrs Adeyemi')`;
  await sql`insert into invitation_legs (invitation_id, leg_id, allowance, rsvp, rsvp_count)
    values (${inv}, ${leg}, 4, 'attending', 4)`;
  await sql`insert into passes (id, invitation_id, event_id)
    values (${pass}, ${inv}, ${event})`;

  return {
    owner, usher, event, leg, gate, inv, pass,
    ownerToken: app.jwt.sign({ sub: owner }),
    usherToken: app.jwt.sign({ sub: usher }),
  };
}

async function scan(
  s: Awaited<ReturnType<typeof seedLeg>>,
  result: string,
  count: number,
) {
  await sql`insert into check_in_events
      (client_uuid, event_id, leg_id, entrance_id, pass_id, invitation_id,
       staff_user_id, result, admitted_count, occupancy_delta, scanned_at)
    values (${randomUUID()}, ${s.event}, ${s.leg}, ${s.gate}, ${s.pass}, ${s.inv},
       ${s.usher}, ${result}::checkin_result, ${count}, ${count}, now())`;
}

/**
 * Opens the SSE stream and collects named events until `want` of them have
 * arrived or the clock runs out. Returns the parsed events.
 */
async function listen(
  token: string,
  legId: string,
  want: number,
  during?: () => Promise<void>,
  ms = 5000,
): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/legs/${legId}/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const events: { event: string; data: Record<string, unknown> }[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ran = false;

  const deadline = setTimeout(() => controller.abort(), ms);
  try {
    while (events.length < want) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const name = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (name && data) events.push({ event: name, data: JSON.parse(data) });
      }

      // Fire the action only once the stream is definitely subscribed,
      // otherwise the notification races the LISTEN.
      if (!ran && during && events.length >= 1) {
        ran = true;
        await during();
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") throw err;
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
  return events;
}

// -------------------------------------------------------------- the stream

test("the stream opens with a snapshot", async () => {
  const s = await seedLeg();
  const events = await listen(s.ownerToken, s.leg, 1);

  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "snapshot");
  const snap = events[0]!.data as {
    counters: Record<string, number>;
    gates: { name: string }[];
  };
  assert.equal(snap.counters.inside, 0);
  assert.equal(snap.counters.confirmed, 4);
  assert.equal(snap.counters.still_expected, 4);
  assert.equal(snap.gates[0]!.name, "Main Gate");
});

test("a scan reaches an open stream, with who and where", async () => {
  const s = await seedLeg();
  const events = await listen(s.ownerToken, s.leg, 2, () => scan(s, "partial", 3));

  const arrival = events.find((e) => e.event === "check_in");
  assert.ok(arrival, "the arrival never came down the wire");
  const { item, counters } = arrival.data as {
    item: Record<string, unknown>;
    counters: Record<string, number>;
  };

  assert.equal(item.display_name, "Mr & Mrs Adeyemi");
  assert.equal(item.entrance_name, "Main Gate");
  assert.equal(item.staff_name, "Musa");
  assert.equal(item.admitted_count, 3);
  assert.equal(item.allowance, 4);
  assert.equal(item.admitted_total, 3, "enough to say '3 of 4 admitted'");

  // The counters ride along, so the tiles never disagree with the feed.
  assert.equal(counters.inside, 3);
  assert.equal(counters.still_expected, 1);
});

test("several scans arrive in order", async () => {
  const s = await seedLeg();
  const events = await listen(s.ownerToken, s.leg, 4, async () => {
    await scan(s, "partial", 2);
    await scan(s, "admitted", 1);
    await scan(s, "invalid", 0);
  });

  const arrivals = events.filter((e) => e.event === "check_in");
  assert.equal(arrivals.length, 3);
  const results = arrivals.map(
    (a) => (a.data as { item: { result: string } }).item.result,
  );
  assert.deepEqual(results, ["partial", "admitted", "invalid"]);

  const last = arrivals.at(-1)!.data as { counters: Record<string, number> };
  assert.equal(last.counters.inside, 3);
  assert.equal(last.counters.refused, 1, "a refusal is in the feed and counted");
});

test("a refusal admits nobody but still shows up", async () => {
  const s = await seedLeg();
  const events = await listen(s.ownerToken, s.leg, 2, () => scan(s, "revoked", 0));
  const arrival = events.find((e) => e.event === "check_in")!;
  const { item, counters } = arrival.data as {
    item: Record<string, unknown>;
    counters: Record<string, number>;
  };
  assert.equal(item.result, "revoked");
  assert.equal(item.admitted_count, 0);
  assert.equal(counters.inside, 0);
  assert.equal(counters.refused, 1);
});

test("overflow is surfaced live, as parties and people", async () => {
  const s = await seedLeg();
  const events = await listen(s.ownerToken, s.leg, 2, () =>
    scan(s, "overflow_admitted", 6),
  );
  const { counters } = events.find((e) => e.event === "check_in")!.data as {
    counters: Record<string, number>;
  };
  assert.equal(counters.inside, 6);
  assert.equal(counters.overflow_parties, 1);
  assert.equal(counters.overflow_people, 2, "invited for 4, six walked in");
});

test("one leg's arrivals do not leak into another leg's stream", async () => {
  const a = await seedLeg();
  const b = await seedLeg();

  // Watch A, scan B: only the snapshot should ever arrive.
  const events = await listen(a.ownerToken, a.leg, 2, () => scan(b, "admitted", 2), 2500);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "snapshot");
});

test("a stranger cannot open the stream", async () => {
  const s = await seedLeg();
  const stranger = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${stranger}, ${phone()}, 'Nosy')`;

  const res = await fetch(`${baseUrl}/legs/${s.leg}/stream`, {
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: stranger })}` },
  });
  assert.equal(res.status, 403);
  await res.body?.cancel();
});

test("closing the browser tab releases the subscription", async () => {
  const s = await seedLeg();
  assert.equal(watcherCount(s.leg), 0);

  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/legs/${s.leg}/stream`, {
    headers: { authorization: `Bearer ${s.ownerToken}` },
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  // Read until the SNAPSHOT specifically. The first chunk is the `retry:`
  // hint, which is written before the subscription exists — waiting on it
  // would check the count too early.
  let seen = "";
  while (!seen.includes("event: snapshot")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  assert.equal(watcherCount(s.leg), 1);

  controller.abort();
  // The close handler runs on the socket's own tick.
  for (let i = 0; i < 40 && watcherCount(s.leg) > 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(watcherCount(s.leg), 0, "a closed tab must not leak a listener");
});

// ------------------------------------------------------------- the snapshot

test("the /live snapshot matches what the stream would have said", async () => {
  const s = await seedLeg();
  await scan(s, "partial", 3);
  await scan(s, "invalid", 0);

  const res = await app.inject({
    method: "GET",
    url: `/legs/${s.leg}/live`,
    headers: { authorization: `Bearer ${s.ownerToken}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.equal(body.counters.inside, 3);
  assert.equal(body.counters.still_expected, 1);
  assert.equal(body.counters.refused, 1);
  assert.equal(body.counters.arrivals_last_hour, 3);
  assert.equal(body.gates[0].name, "Main Gate");
  assert.equal(body.gates[0].admitted, 3);
  assert.equal(body.gates[0].ushers, "Musa");

  assert.equal(body.feed.length, 2, "newest first");
  assert.equal(body.feed[0].result, "invalid");
  assert.equal(body.feed[1].result, "partial");
});

test("a stranger gets nothing from the snapshot either", async () => {
  const s = await seedLeg();
  const stranger = randomUUID();
  await sql`insert into users (id, phone, full_name) values (${stranger}, ${phone()}, 'Nosy')`;
  const res = await app.inject({
    method: "GET",
    url: `/legs/${s.leg}/live`,
    headers: { authorization: `Bearer ${app.jwt.sign({ sub: stranger })}` },
  });
  assert.equal(res.statusCode, 403);
});
