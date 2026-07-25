// The import endpoint. csv.test.ts covers the parsing; this covers what
// reaches the database, and the rule that importing is always free.
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

async function newEvent(token: string) {
  const res = await app.inject({
    method: "POST",
    url: "/events",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: "Ahmed & Aisha",
      leg: { name: "Reception", starts_at: "2026-12-12T16:00:00+01:00" },
    },
  });
  assert.equal(res.statusCode, 201);
  return res.json();
}

/**
 * Hand-built multipart body. Using the real wire format rather than a
 * helper keeps the test honest about what a browser actually sends.
 */
function multipart(
  csv: string,
  fields: Record<string, string> = {},
  filename = "guest-list.csv",
) {
  const boundary = `----ImportTest${randomUUID().replace(/-/g, "")}`;
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: text/csv\r\n\r\n${csv}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return {
    body: Buffer.from(parts.join(""), "utf8"),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function upload(
  token: string,
  eventId: string,
  csv: string,
  fields: Record<string, string> = {},
) {
  const { body, contentType } = multipart(csv, fields);
  return app.inject({
    method: "POST",
    url: `/events/${eventId}/invitations/import`,
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    payload: body,
  });
}

const SHEET = [
  "Name,No. of guests,Phone,Side",
  "Mr & Mrs Adeyemi,4,0803 411 2098,Groom's Family",
  "Chidinma Okafor,1,08051234567,Bride's Colleagues",
  '"Chief, ""The Lion"" Obi",2,08099998888,Groom\'s Family',
].join("\r\n");

// ------------------------------------------------------------------ preview

test("a dry run previews the mapping and writes nothing", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const res = await upload(o.token, event.id, SHEET, { dry_run: "true" });
  assert.equal(res.statusCode, 200);
  const p = res.json();

  assert.equal(p.status, "preview");
  assert.equal(p.imported, 0);
  assert.equal(p.file, "guest-list.csv");
  assert.equal(p.total_rows, 3);
  assert.equal(p.would_import, 3);
  assert.equal(p.people, 7, "4 + 1 + 2");
  assert.deepEqual(p.headers, ["Name", "No. of guests", "Phone", "Side"]);
  assert.equal(p.mapping["0"], "display_name");
  assert.equal(p.mapping["1"], "allowance");
  assert.equal(p.mapping["2"], "primary_phone");
  assert.equal(p.mapping["3"], "category");
  assert.equal(p.preview.length, 3);
  assert.equal(p.preview[0].primary_phone, "+2348034112098");

  const [count] = await sql`
    select count(*)::int as n from invitations where event_id = ${event.id}`;
  assert.equal(count!.n, 0, "a preview must not write");
});

// ------------------------------------------------------------------- commit

test("committing creates households, per-leg allowances and passes", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const res = await upload(o.token, event.id, SHEET);
  assert.equal(res.statusCode, 202);
  const r = res.json();
  assert.equal(r.status, "done");
  assert.equal(r.imported, 3);

  const rows = await sql`
    select i.display_name, i.primary_phone, il.allowance, gc.name as category,
           (select count(*)::int from passes p where p.invitation_id = i.id) as passes
    from invitations i
    join invitation_legs il on il.invitation_id = i.id and il.leg_id = ${legId}
    left join guest_categories gc on gc.id = i.category_id
    where i.event_id = ${event.id}
    order by i.display_name`;

  assert.equal(rows.length, 3);
  const byName = Object.fromEntries(rows.map((r) => [r.display_name, r]));

  assert.equal(byName["Mr & Mrs Adeyemi"]!.allowance, 4);
  assert.equal(byName["Mr & Mrs Adeyemi"]!.primary_phone, "+2348034112098");
  assert.equal(byName["Mr & Mrs Adeyemi"]!.category, "Groom's Family");
  // Every household gets a pass at creation, before any RSVP.
  assert.ok(rows.every((r) => r.passes === 1));

  // The quoted name survived the round trip intact.
  assert.ok(byName['Chief, "The Lion" Obi'], "quoted commas must not split a household");
  assert.equal(byName['Chief, "The Lion" Obi']!.allowance, 2);

  // Categories named in the sheet were created once, not per row.
  const cats = await sql`
    select name from guest_categories where event_id = ${event.id} order by name`;
  assert.deepEqual(cats.map((c) => c.name), ["Bride's Colleagues", "Groom's Family"]);
});

test("re-uploading the same file does not double the guest list", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const first = await upload(o.token, event.id, SHEET);
  assert.equal(first.json().imported, 3);

  const second = await upload(o.token, event.id, SHEET);
  assert.equal(second.json().imported, 0);
  assert.equal(second.json().already_on_list, 3);

  const [count] = await sql`
    select count(*)::int as n from invitations where event_id = ${event.id}`;
  assert.equal(count!.n, 3);
});

test("a second file adds only the households that are new", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  await upload(o.token, event.id, SHEET);

  const more = [
    "Name,No. of guests,Phone",
    "Mr & Mrs Adeyemi,4,0803 411 2098", // already there, by phone
    "Adaeze Nwosu,3,08077776666",
  ].join("\n");
  const res = await upload(o.token, event.id, more);
  assert.equal(res.json().imported, 1);
  assert.equal(res.json().already_on_list, 1);

  const [count] = await sql`
    select count(*)::int as n from invitations where event_id = ${event.id}`;
  assert.equal(count!.n, 4);
});

test("seating in the sheet is honoured, and tables switched on", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legId = event.legs[0].id;

  const sheet = [
    "Name,Pax,Table",
    "Mr & Mrs Adeyemi,4,Table 12",
    "Adaeze Nwosu,2,Table 12",
    "Emeka Balogun,1,VIP Table",
  ].join("\n");
  const res = await upload(o.token, event.id, sheet);
  assert.equal(res.json().imported, 3);

  const tables = await sql`
    select name from seating_tables where leg_id = ${legId} order by name`;
  assert.deepEqual(tables.map((t) => t.name), ["Table 12", "VIP Table"]);

  const seated = await sql`
    select i.display_name, st.name as table_name
    from invitation_legs il
    join invitations i on i.id = il.invitation_id
    join seating_tables st on st.id = il.table_id
    where il.leg_id = ${legId} order by i.display_name`;
  assert.equal(seated.length, 3);
  assert.equal(
    seated.filter((s) => s.table_name === "Table 12").length,
    2,
    "two households share one table, created once",
  );

  const [leg] = await sql`select tables_enabled from event_legs where id = ${legId}`;
  assert.equal(leg!.tables_enabled, true);
});

test("multi-leg: an import invites households to every leg by default", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legB = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legB}, ${event.id}, 'Traditional', 2, now())`;

  await upload(o.token, event.id, "Name,Pax\nMr & Mrs Adeyemi,4");

  const legs = await sql`
    select leg_id, allowance from invitation_legs il
    join invitations i on i.id = il.invitation_id
    where i.event_id = ${event.id}`;
  assert.equal(legs.length, 2, "one household, two legs");
  assert.ok(legs.every((l) => l.allowance === 4));

  // …and billing still counts them as four humans, not eight.
  const [billable] = await sql`select billable_people(${event.id}::uuid) as n`;
  assert.equal(Number(billable!.n), 4);
});

test("leg_ids narrows the import to the legs named", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const legA = event.legs[0].id;
  const legB = randomUUID();
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at)
    values (${legB}, ${event.id}, 'Traditional', 2, now())`;

  await upload(o.token, event.id, "Name,Pax\nAbuja Only,3", { leg_ids: legB });

  const legs = await sql`
    select il.leg_id from invitation_legs il
    join invitations i on i.id = il.invitation_id
    where i.event_id = ${event.id}`;
  assert.equal(legs.length, 1);
  assert.equal(legs[0]!.leg_id, legB);
  assert.notEqual(legs[0]!.leg_id, legA);
});

test("an explicit mapping overrides the guessed one", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  // Headings that would guess wrong: "Name" here is really the category.
  const sheet = "Name,Household,Pax\nGroom's Family,Mr & Mrs Adeyemi,4";
  const res = await upload(o.token, event.id, sheet, {
    mapping: JSON.stringify({ 0: "category", 1: "display_name", 2: "allowance" }),
  });
  assert.equal(res.json().imported, 1);

  const [inv] = await sql`
    select i.display_name, gc.name as category
    from invitations i left join guest_categories gc on gc.id = i.category_id
    where i.event_id = ${event.id}`;
  assert.equal(inv!.display_name, "Mr & Mrs Adeyemi");
  assert.equal(inv!.category, "Groom's Family");
});

// ------------------------------------------------------- the important rule

test("importing is free and never blocked by the people limit", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  // Free plan: 150 people. Import 500.
  const rows = ["Name,Pax"];
  for (let n = 1; n <= 100; n++) rows.push(`Household ${n},5`);

  const res = await upload(o.token, event.id, rows.join("\n"));
  assert.equal(res.statusCode, 202, "a 402 here would be the wrong product");
  assert.equal(res.json().imported, 100);
  assert.equal(res.json().people, 500);

  const [billable] = await sql`select billable_people(${event.id}::uuid) as n`;
  assert.equal(Number(billable!.n), 500);

  // The limit is real — it just applies at SENDING, not here.
  const [ev] = await sql`select people_limit from events where id = ${event.id}`;
  assert.equal(ev!.people_limit, 150);
});

// ------------------------------------------------------------- odd files

test("warnings come back grouped, and the good rows still import", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const messy = [
    "Name,No. of guests,Phone",
    "Adaeze Nwosu,,08034112098", // no party size
    "Emeka Balogun,plenty,0803", // unreadable size, bad phone
    ",4,08055554444", // no name at all
    "Adaeze Nwosu,2,08066665555", // duplicate name
  ].join("\n");

  const res = await upload(o.token, event.id, messy);
  assert.equal(res.statusCode, 202);
  const r = res.json();

  assert.equal(r.imported, 3, "the nameless row is skipped, the rest land");
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].kind, "no_name");

  const kinds = r.warning_summary.map((w: { kind: string }) => w.kind);
  assert.ok(kinds.includes("no_party_size"));
  assert.ok(kinds.includes("bad_party_size"));
  assert.ok(kinds.includes("incomplete_phone"));
  assert.ok(kinds.includes("duplicate_name"));
  assert.ok(kinds.includes("no_name"));

  const sentence = r.warning_summary.find(
    (w: { kind: string }) => w.kind === "no_party_size",
  ).message;
  assert.match(sentence, /1 row has no party size — we'll set it to 1\./);
});

test("a header-only file imports nothing and says so calmly", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const res = await upload(o.token, event.id, "Name,Pax\n");
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().imported, 0);
  assert.equal(res.json().total_rows, 0);
});

test("a file with no recognisable headings still imports names", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const res = await upload(o.token, event.id, "col1,col2\nMr & Mrs Adeyemi,4");
  assert.equal(res.json().imported, 1);
  assert.equal(res.json().has_allowance_column, false);

  const [inv] = await sql`
    select display_name from invitations where event_id = ${event.id}`;
  assert.equal(inv!.display_name, "Mr & Mrs Adeyemi");
});

// -------------------------------------------------------------- rejections

test("a request without a file, or not multipart, is refused clearly", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);

  const notMultipart = await app.inject({
    method: "POST",
    url: `/events/${event.id}/invitations/import`,
    headers: { authorization: `Bearer ${o.token}` },
    payload: { file: "nope" },
  });
  assert.equal(notMultipart.statusCode, 415);
  assert.equal(notMultipart.json().code, "expected_multipart");
});

test("a stranger cannot import into someone else's event", async () => {
  const o = await organiser();
  const stranger = await organiser();
  const event = await newEvent(o.token);

  const res = await upload(stranger.token, event.id, SHEET);
  assert.equal(res.statusCode, 403);

  const [count] = await sql`
    select count(*)::int as n from invitations where event_id = ${event.id}`;
  assert.equal(count!.n, 0);
});

test("too many rows is refused rather than half-imported", async () => {
  const o = await organiser();
  const event = await newEvent(o.token);
  const rows = ["Name,Pax"];
  for (let n = 1; n <= 5_001; n++) rows.push(`Household ${n},2`);

  const res = await upload(o.token, event.id, rows.join("\n"));
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().code, "too_many_rows");

  const [count] = await sql`
    select count(*)::int as n from invitations where event_id = ${event.id}`;
  assert.equal(count!.n, 0, "nothing should be written before the check");
});
