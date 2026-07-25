import type { FastifyInstance, FastifyReply } from "fastify";
import { sql } from "./db.ts";
import { verifyToken } from "checkin-core/token";

/**
 * Guest-facing routes. Unauthenticated by design.
 *
 * The URL token IS the pass token: it is HMAC-signed, unguessable, carries
 * no personal data, and is exactly what the WhatsApp link and the QR code
 * already contain. One token, one household, everywhere. Failures are a
 * uniform 404 — a guesser learns nothing about why.
 *
 * The pass is available before any RSVP (architecture decision #1) — many
 * guests simply turn up, and the gate must recognise them.
 */

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ code: "not_found", message: "No such invitation." });
}

/** Read the event id out of a raw token without verifying it (yet). */
function eventIdFromToken(raw: string): string | null {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return null;
  const b = Buffer.from(parts[1]!, "base64url");
  if (b.length !== 16) return null;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Resolved = {
  invitationId: string;
  eventName: string;
  note: string | null;
  rsvpDeadline: string | null;
  displayName: string;
};

/** Token → active pass → household, or null. */
async function resolve(raw: string): Promise<Resolved | null> {
  const eventId = eventIdFromToken(raw);
  if (!eventId) return null;

  const [event] = await sql`
    select id, name, description, rsvp_deadline, token_version, signing_key
    from events where id = ${eventId}`;
  if (!event) return null;

  const v = verifyToken(raw, [{
    eventId: event.id,
    eventName: event.name,
    tokenVersion: event.token_version,
    key: Buffer.from(event.signing_key),
  }]);
  if (!v.ok) return null;

  const [row] = await sql`
    select i.id as invitation_id, i.display_name
    from passes p join invitations i on i.id = p.invitation_id
    where p.id = ${v.payload.passId} and p.status = 'active'`;
  if (!row) return null;

  return {
    invitationId: row.invitation_id,
    eventName: event.name,
    note: event.description,
    rsvpDeadline: event.rsvp_deadline,
    displayName: row.display_name,
  };
}

async function publicInvitation(raw: string, r: Resolved) {
  const legs = await sql`
    select
      il.leg_id,
      l.name,
      l.starts_at,
      l.venue_name,
      l.address_line,
      case when l.latitude is not null and l.longitude is not null
           then 'https://maps.google.com/?q=' || l.latitude || ',' || l.longitude
           else null end as map_url,
      il.allowance,
      il.rsvp,
      il.rsvp_count,
      st.name as table_name
    from invitation_legs il
    join event_legs l on l.id = il.leg_id
    left join seating_tables st on st.id = il.table_id
    where il.invitation_id = ${r.invitationId}
    order by l.sequence`;

  return {
    event_name: r.eventName,
    note: r.note,
    display_name: r.displayName,
    pass_code: raw.trim(),
    legs,
  };
}

export async function publicRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>(
    "/public/invitations/:token",
    async (req, reply) => {
      const r = await resolve(req.params.token);
      if (!r) return notFound(reply);
      return publicInvitation(req.params.token, r);
    },
  );

  app.post<{
    Params: { token: string };
    Body: { leg_id?: string; attending?: boolean; count?: number };
  }>("/public/invitations/:token/rsvp", async (req, reply) => {
    const r = await resolve(req.params.token);
    if (!r) return notFound(reply);

    const { leg_id, attending, count } = req.body ?? {};
    if (typeof leg_id !== "string" || typeof attending !== "boolean") {
      return reply.code(400).send({ code: "bad_request", message: "leg_id and attending are required." });
    }
    if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
      return reply.code(400).send({ code: "bad_request", message: "count must be a non-negative integer." });
    }

    if (r.rsvpDeadline && new Date(r.rsvpDeadline).getTime() + 86_400_000 < Date.now()) {
      return reply.code(409).send({ code: "deadline_passed", message: "The reply deadline has passed." });
    }

    const [legRow] = await sql`
      select allowance from invitation_legs
      where invitation_id = ${r.invitationId} and leg_id = ${leg_id}`;
    if (!legRow) return notFound(reply);

    // "Three of our four are coming" is a promise of three people —
    // partial counts as confirmed (the caterer's number is sacred).
    let rsvp: string;
    let rsvpCount: number;
    if (!attending || count === 0) {
      rsvp = "declined";
      rsvpCount = 0;
    } else {
      rsvpCount = Math.min(count ?? legRow.allowance, legRow.allowance);
      rsvp = rsvpCount < legRow.allowance ? "partial" : "attending";
    }

    await sql`
      update invitation_legs
      set rsvp = ${rsvp}::rsvp_status, rsvp_count = ${rsvpCount}, responded_at = now()
      where invitation_id = ${r.invitationId} and leg_id = ${leg_id}`;

    return publicInvitation(req.params.token, r);
  });
}
