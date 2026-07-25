// Shared test seeding. Only ever imported by *.test.ts files, which import
// ./testdb.ts first — so this always runs against guest_test.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sqlAdmin as sql } from "./db.ts";
import { issueToken } from "checkin-core/token";

export type Seeded = {
  eventId: string;
  legId: string;
  entranceId: string;
  usherId: string;
  usherToken: string;
  outsiderToken: string;
  /** allowance-4 household */
  passId: string;
  invitationId: string;
  /** allowance-1 household */
  soloPassId: string;
};

const phone = () => `+234${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;

export async function seedEvent(
  app: FastifyInstance,
  opts?: {
    allowOverflow?: boolean;
    requireRsvp?: boolean;
    canOverride?: boolean;
    rsvpDeadline?: string;
  },
): Promise<Seeded> {
  // Plugins (incl. @fastify/jwt) register lazily; sign() needs them loaded.
  await app.ready();
  const owner = randomUUID(), usher = randomUUID(), outsider = randomUUID();
  const ws = randomUUID(), event = randomUUID(), leg = randomUUID();
  const entrance = randomUUID();
  const inv = randomUUID(), pass = randomUUID();
  const soloInv = randomUUID(), soloPass = randomUUID();

  await sql`insert into users (id, phone, full_name) values
    (${owner}, ${phone()}, 'Owner'),
    (${usher}, ${phone()}, 'Usher Musa'),
    (${outsider}, ${phone()}, 'Not Staff')`;
  await sql`insert into workspaces (id, name, owner_user_id) values (${ws}, 'WS', ${owner})`;
  await sql`insert into events (id, workspace_id, name, description, signing_key, status,
      allow_overflow, require_rsvp, rsvp_deadline)
    values (${event}, ${ws}, 'Test Wedding', 'Aso-ebi is emerald and gold.',
      gen_random_bytes(32), 'active',
      ${opts?.allowOverflow ?? true}, ${opts?.requireRsvp ?? false},
      ${opts?.rsvpDeadline ?? null})`;
  await sql`insert into event_legs (id, event_id, name, sequence, starts_at,
      venue_name, address_line, latitude, longitude)
    values (${leg}, ${event}, 'Main', 1, now(),
      'Oriental Hotel', '3 Lekki-Epe Expressway', 6.4281, 3.4216)`;
  await sql`insert into entrances (id, leg_id, name) values (${entrance}, ${leg}, 'Main Gate')`;
  await sql`insert into staff_assignments (user_id, leg_id, entrance_id, can_manual, can_override)
    values (${usher}, ${leg}, ${entrance}, true, ${opts?.canOverride ?? false})`;

  await sql`insert into invitations (id, event_id, display_name, primary_phone) values
    (${inv}, ${event}, 'Mr & Mrs Adeyemi', ${phone()}),
    (${soloInv}, ${event}, 'Chidinma Okafor', ${phone()})`;
  await sql`insert into invitation_legs (invitation_id, leg_id, allowance) values
    (${inv}, ${leg}, 4), (${soloInv}, ${leg}, 1)`;
  await sql`insert into passes (id, invitation_id, event_id) values
    (${pass}, ${inv}, ${event}), (${soloPass}, ${soloInv}, ${event})`;

  return {
    eventId: event,
    legId: leg,
    entranceId: entrance,
    usherId: usher,
    usherToken: app.jwt.sign({ sub: usher }),
    outsiderToken: app.jwt.sign({ sub: outsider }),
    passId: pass,
    invitationId: inv,
    soloPassId: soloPass,
  };
}

/** Issue a real pass token from the event's signing key in the database. */
export async function passTokenFor(passId: string, eventId: string): Promise<string> {
  const [event] = await sql`
    select signing_key, token_version from events where id = ${eventId}`;
  if (!event) throw new Error("no such event");
  return issueToken(
    { passId, eventId, tokenVersion: event.token_version },
    Buffer.from(event.signing_key),
  );
}
