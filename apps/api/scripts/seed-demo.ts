// Demo data for local development — the mockup's own wedding, made real.
// Idempotent: fixed ids, safe to run repeatedly. Prints the guest URL.
//   npx tsx scripts/seed-demo.ts
import { sqlAdmin as sql, closeDb } from "../src/db.ts";
import { issueToken } from "checkin-core/token";

const IDS = {
  owner: "d0000000-0000-4000-8000-000000000001",
  usher: "d0000000-0000-4000-8000-000000000002",
  ws: "d0000000-0000-4000-8000-000000000010",
  event: "d0000000-0000-4000-8000-000000000020",
  leg: "d0000000-0000-4000-8000-000000000030",
  gate: "d0000000-0000-4000-8000-000000000040",
  table12: "d0000000-0000-4000-8000-000000000050",
  catFamily: "d0000000-0000-4000-8000-000000000060",
  adeyemi: "d0000000-0000-4000-8000-000000000070",
  adeyemiPass: "d0000000-0000-4000-8000-000000000071",
  okafor: "d0000000-0000-4000-8000-000000000080",
  okaforPass: "d0000000-0000-4000-8000-000000000081",
};

await sql`insert into users (id, phone, full_name) values
    (${IDS.owner}, '+2348030000001', 'Ahmed'),
    (${IDS.usher}, '+2348030000002', 'Musa')
  on conflict (id) do nothing`;

await sql`insert into workspaces (id, name, owner_user_id)
  values (${IDS.ws}, 'Ahmed & Aisha', ${IDS.owner})
  on conflict (id) do nothing`;

await sql`insert into events (id, workspace_id, name, description, signing_key,
    status, plan, people_limit, rsvp_deadline)
  values (${IDS.event}, ${IDS.ws}, 'Ahmed & Aisha',
    'Aso-ebi colours are emerald and gold. Parking fills quickly after 3 PM — the Ozumba gate is usually clearer.',
    gen_random_bytes(32), 'active', 'standard', 600, '2026-12-01')
  on conflict (id) do nothing`;

await sql`insert into event_legs (id, event_id, name, sequence, starts_at,
    doors_close_at, venue_name, address_line, city, latitude, longitude, tables_enabled)
  values (${IDS.leg}, ${IDS.event}, 'Reception', 1,
    '2026-12-12 16:00:00+01', '2026-12-12 18:30:00+01',
    'Oriental Hotel', '3 Lekki–Epe Expressway, Victoria Island', 'Lagos',
    6.4281, 3.4216, true)
  on conflict (id) do nothing`;

await sql`insert into entrances (id, leg_id, name) values (${IDS.gate}, ${IDS.leg}, 'Main Gate')
  on conflict (id) do nothing`;

await sql`insert into seating_tables (id, leg_id, name, capacity)
  values (${IDS.table12}, ${IDS.leg}, 'Table 12', 10)
  on conflict (id) do nothing`;

await sql`insert into guest_categories (id, event_id, name)
  values (${IDS.catFamily}, ${IDS.event}, $$Groom's Family$$)
  on conflict (id) do nothing`;

await sql`insert into staff_assignments (user_id, leg_id, entrance_id, can_manual)
  values (${IDS.usher}, ${IDS.leg}, ${IDS.gate}, true)
  on conflict (user_id, leg_id) do nothing`;

await sql`insert into invitations (id, event_id, display_name, primary_phone, category_id) values
    (${IDS.adeyemi}, ${IDS.event}, 'Mr & Mrs Adeyemi', '+2348034112098', ${IDS.catFamily}),
    (${IDS.okafor}, ${IDS.event}, 'Chidinma Okafor', '+2348051234567', null)
  on conflict (id) do nothing`;

await sql`insert into invitation_legs (invitation_id, leg_id, allowance, table_id) values
    (${IDS.adeyemi}, ${IDS.leg}, 4, ${IDS.table12}),
    (${IDS.okafor}, ${IDS.leg}, 1, null)
  on conflict (invitation_id, leg_id) do nothing`;

await sql`insert into passes (id, invitation_id, event_id) values
    (${IDS.adeyemiPass}, ${IDS.adeyemi}, ${IDS.event}),
    (${IDS.okaforPass}, ${IDS.okafor}, ${IDS.event})
  on conflict (id) do nothing`;

const [event] = await sql`
  select signing_key, token_version from events where id = ${IDS.event}`;

const tokenFor = (passId: string) =>
  issueToken(
    { passId, eventId: IDS.event, tokenVersion: event!.token_version },
    Buffer.from(event!.signing_key),
  );

console.log("Seeded. Guest pages:");
console.log(`  Mr & Mrs Adeyemi (4):  http://localhost:3000/i/${tokenFor(IDS.adeyemiPass)}`);
console.log(`  Chidinma Okafor (1):   http://localhost:3000/i/${tokenFor(IDS.okaforPass)}`);
console.log("Usher login: +2348030000002 (OTP shown by the API in dev)");

await closeDb();
