// A wedding-sized dress rehearsal, end to end, against a real database.
//
//   npx tsx scripts/rehearse.ts            400 households
//   npx tsx scripts/rehearse.ts 1200       a very large wedding
//
// Everything before this was proven on three households. Three tells you
// the logic is right and nothing about the things that only appear at
// size: how long an import takes, how big the payload a phone has to
// download is, whether search is usable, whether the reports the couple
// look at the next morning still add up when there are four hundred rows
// behind them.
//
// Runs the real HTTP routes in-process against the throwaway test
// database. Nothing here touches the deployed system.
import "../src/testdb.ts";

import { randomUUID } from "node:crypto";
import { buildServer } from "../src/server.ts";
import { sqlAdmin as sql, closeDb } from "../src/db.ts";
import { issueToken } from "checkin-core/token";
import { makeCsv } from "./make-rehearsal-csv.ts";

const HOUSEHOLDS = Number(process.argv[2] ?? 400);

const app = buildServer();

function ms(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = process.hrtime.bigint();
  const out = await fn();
  console.log(`  ${label.padEnd(46)} ${ms(t).toFixed(0).padStart(6)} ms`);
  return out;
}

function multipart(csv: string, fields: Record<string, string> = {}) {
  const boundary = `----Rehearsal${randomUUID().replace(/-/g, "")}`;
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
      `filename="guest-list.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return {
    body: Buffer.from(parts.join(""), "utf8"),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function main(): Promise<void> {
  await app.ready();
  console.log(`\nRehearsal: ${HOUSEHOLDS} households\n`);

  // ---- the cast ----------------------------------------------------------
  const organiserId = randomUUID();
  await sql`insert into users (id, phone, full_name)
            values (${organiserId}, ${"+234" + String(Date.now()).slice(-10)}, 'Rehearsal Organiser')`;
  const token = app.jwt.sign({ sub: organiserId });
  const auth = { authorization: `Bearer ${token}` };

  const created = await app.inject({
    method: "POST",
    url: "/events",
    headers: auth,
    payload: {
      name: "Rehearsal Wedding",
      leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
    },
  });
  if (created.statusCode !== 201) throw new Error(`event: ${created.body}`);
  const event = created.json();
  const legId = event.legs?.[0]?.id ?? event.leg?.id;

  // ---- 1. import ---------------------------------------------------------
  console.log("IMPORT");
  const csv = makeCsv(HOUSEHOLDS);
  console.log(`  csv ${(csv.length / 1024).toFixed(0)} KB`);

  const { body, contentType } = multipart(csv, { mode: "commit" });
  const imported = await timed("POST /invitations/import", async () =>
    app.inject({
      method: "POST",
      url: `/events/${event.id}/invitations/import`,
      headers: { ...auth, "content-type": contentType },
      payload: body,
    }),
  );
  if (imported.statusCode >= 400) throw new Error(`import: ${imported.body}`);
  const summary = imported.json();
  console.log(
    `  ${summary.created ?? summary.imported ?? "?"} created, ` +
      `${summary.people ?? "?"} people, ${(summary.warnings ?? []).length} warnings`,
  );
  const byKind: Record<string, number> = {};
  for (const w of summary.warnings ?? []) byKind[w.kind] = (byKind[w.kind] ?? 0) + 1;
  for (const [kind, n] of Object.entries(byKind)) {
    const sample = (summary.warnings ?? []).find((w: { kind: string }) => w.kind === kind);
    console.log(`    ${String(n).padStart(4)} x ${kind}  e.g. "${sample?.message}"`);
  }

  const [{ n: households }] = await sql<{ n: string }[]>`
    select count(*) n from invitations where event_id = ${event.id}`;
  const [{ n: people }] = await sql<{ n: string }[]>`
    select coalesce(sum(allowance),0) n from invitation_legs il
    join invitations i on i.id = il.invitation_id where i.event_id = ${event.id}`;
  console.log(`  in the database: ${households} households, ${people} people`);

  // ---- 1b. RSVPs ---------------------------------------------------------
  //
  // Without these the report's headline numbers are all zero, and the
  // numbers the couple actually read the next morning — confirmed, and
  // who confirmed then did not come — never get exercised. A real list
  // has a long tail of people who simply never reply.
  console.log("\nRSVP  (most reply: attending, fewer-than-invited, or no)");
  await timed("simulate replies", async () => {
    await sql`
      update invitation_legs il set
        rsvp = case
          when random() < 0.30 then 'pending'::rsvp_status
          when random() < 0.12 then 'declined'::rsvp_status
          when random() < 0.20 then 'partial'::rsvp_status
          else 'attending'::rsvp_status
        end
      from invitations i
      where i.id = il.invitation_id and i.event_id = ${event.id}
        and il.leg_id = ${legId}`;
    // A partial reply confirms fewer than were invited; attending confirms
    // the lot. Declined confirms nobody, which is not the same as null.
    await sql`
      update invitation_legs il set
        rsvp_count = case il.rsvp
          when 'attending' then il.allowance
          when 'partial'   then greatest(1, il.allowance - 1)
          when 'declined'  then 0
          else null
        end
      from invitations i
      where i.id = il.invitation_id and i.event_id = ${event.id}
        and il.leg_id = ${legId}`;
    return null;
  });

  // ---- 2. what the organiser's screens do --------------------------------
  console.log("\nORGANISER");
  await timed("GET /events/:id/guests  (the list page)", async () => {
    const r = await app.inject({
      method: "GET", url: `/events/${event.id}/invitations`, headers: auth,
    });
    if (r.statusCode >= 400) throw new Error(r.body);
    return r;
  });
  await timed("GET /events/:id/report", async () => {
    const r = await app.inject({
      method: "GET", url: `/events/${event.id}/report`, headers: auth,
    });
    if (r.statusCode >= 400) throw new Error(r.body);
    return r;
  });

  // ---- 3. what a phone has to swallow ------------------------------------
  console.log("\nSCANNER BOOTSTRAP  (downloaded once, then works offline)");
  const usherId = randomUUID();
  await sql`insert into users (id, phone, full_name)
            values (${usherId}, ${"+234" + String(Date.now() + 1).slice(-10)}, 'Rehearsal Usher')`;
  await sql`insert into staff_assignments (user_id, leg_id, can_walk_in)
            values (${usherId}, ${legId}, true)`;
  const usherToken = app.jwt.sign({ sub: usherId });
  const usherAuth = { authorization: `Bearer ${usherToken}` };

  const boot = await timed("GET /scanner/legs/:id/bootstrap", async () => {
    const r = await app.inject({
      method: "GET", url: `/scanner/legs/${legId}/bootstrap`, headers: usherAuth,
    });
    if (r.statusCode >= 400) throw new Error(r.body);
    return r;
  });
  const bytes = Buffer.byteLength(boot.body, "utf8");
  console.log(
    `  payload ${(bytes / 1024).toFixed(0)} KB` +
      `  (~${(bytes / 1024 / 1024 * 8).toFixed(1)} Mb — seconds on 3G)`,
  );

  // ---- 4. a queue at the gate -------------------------------------------
  console.log("\nTHE GATE");
  const passes = await sql<
    { id: string; invitation_id: string; allowance: number }[]
  >`
    select p.id, p.invitation_id, il.allowance
    from passes p
    join invitations i on i.id = p.invitation_id
    join invitation_legs il
      on il.invitation_id = i.id and il.leg_id = ${legId}
    where i.event_id = ${event.id} limit 100`;
  const [{ signing_key: key, token_version: ver }] = await sql<
    { signing_key: Buffer; token_version: number }[]
  >`select signing_key, token_version from events where id = ${event.id}`;

  const t = process.hrtime.bigint();
  let admitted = 0;
  for (const p of passes) {
    const raw = issueToken(
      { passId: p.id, eventId: event.id, tokenVersion: ver },
      Buffer.from(key),
    );
    const r = await app.inject({
      method: "POST",
      url: `/scanner/legs/${legId}/scan`,
      headers: usherAuth,
      // client_uuid is the idempotency key a real scanner generates per
      // scan; the endpoint refuses without it, which is how this script
      // got 0 admitted on its first run.
      payload: {
        raw,
        requested_count: p.allowance,
        client_uuid: randomUUID(),
      },
    });
    if (r.statusCode < 400) admitted++;
    else if (admitted === 0 && passes.indexOf(p) === 0) {
      console.log(`  first scan refused: HTTP ${r.statusCode} ${r.body.slice(0, 200)}`);
    }
  }
  const total = ms(t);
  console.log(`  ${passes.length} scans in ${total.toFixed(0)} ms` +
    `  (${(total / passes.length).toFixed(1)} ms each, ${admitted} accepted)`);

  // ---- 5. does the morning-after report add up? --------------------------
  console.log("\nAFTER");
  const report = await app.inject({
    method: "GET", url: `/events/${event.id}/report`, headers: auth,
  });
  const leg = report.json().legs?.[0] ?? {};
  for (const [k, v] of Object.entries(leg)) {
    if (typeof v === "number" || typeof v === "string") {
      console.log(`  ${String(k).padEnd(24)} ${v}`);
    }
  }

  const [{ n: logged }] = await sql<{ n: string }[]>`
    select count(*) n from check_in_events where leg_id = ${legId}`;
  console.log(`  check_in_events rows: ${logged}`);

  // A refusal is an HTTP 200 carrying a "no" — it is a decision, not an
  // error, and it is logged like any other. Worth naming: a refusal
  // nobody expected is the thing that starts an argument at the gate.
  const results = await sql<{ result: string; n: string }[]>`
    select result, count(*) n from check_in_events
    where leg_id = ${legId} group by result order by count(*) desc`;
  for (const r of results) console.log(`    ${String(r.n).padStart(4)} x ${r.result}`);

  console.log("\nDone. Nothing here touched the deployed system.\n");
}

try {
  await main();
} catch (err) {
  console.error(`\nRehearsal failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await app.close();
  await closeDb();
}
