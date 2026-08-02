import type { FastifyInstance, FastifyReply } from "fastify";
import { asPass, sqlVerify, type Db } from "./db.ts";
import { verifyToken } from "checkin-core/token";
import { tooMany } from "./ratelimit.ts";

/**
 * Guest-facing routes. Unauthenticated by design.
 *
 * The URL token IS the pass token: HMAC-signed, unguessable, carrying no
 * personal data, and exactly what the WhatsApp link and the QR code
 * already contain. One token, one household, everywhere. Failures are a
 * uniform 404 — a guesser learns nothing about why.
 *
 * Two database identities, deliberately split (db/migrations/003_rls.sql):
 *
 *   sqlVerify  reads the event signing key and NOTHING else in the
 *              database, only to check the HMAC
 *   asPass     reads one household, scoped by policy to the verified pass,
 *              and cannot see a signing key at all
 *
 * So a leak of either credential alone cannot both forge passes and read
 * guest data.
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
  try {
    const b = Buffer.from(parts[1]!, "base64url");
    if (b.length !== 16) return null;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return null;
  }
}

/** Token → verified pass id, or null. Uses the verifier identity only. */
async function verifiedPassId(raw: string): Promise<string | null> {
  const eventId = eventIdFromToken(raw);
  if (!eventId) return null;

  const [event] = await sqlVerify`
    select id, name, token_version, signing_key from events where id = ${eventId}`;
  if (!event) return null;

  const v = verifyToken(raw, [
    {
      eventId: event.id,
      eventName: event.name,
      tokenVersion: event.token_version,
      key: Buffer.from(event.signing_key),
    },
  ]);
  return v.ok ? v.payload.passId : null;
}

type Household = {
  invitationId: string;
  eventName: string;
  note: string | null;
  rsvpDeadline: string | null;
  displayName: string;
  /** Settings promises the guest a notice; this is what carries it. */
  cancelled: boolean;
};

/**
 * The household behind a verified pass. Policies do the scoping: an
 * inactive pass yields no invitation, so a revoked link reads as 404
 * without a status check here.
 */
async function household(db: Db): Promise<Household | null> {
  const [row] = await db`
    select i.id as invitation_id, i.display_name,
           e.name as event_name, e.description, e.rsvp_deadline,
           e.status
    from invitations i
    join events e on e.id = i.event_id
    where i.id = app_pass_invitation()`;
  if (!row) return null;
  return {
    invitationId: row.invitation_id,
    eventName: row.event_name,
    note: row.description,
    rsvpDeadline: row.rsvp_deadline,
    displayName: row.display_name,
    cancelled: row.status === "cancelled",
  };
}

async function publicInvitation(db: Db, raw: string, h: Household) {
  const legs = await db`
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
    where il.invitation_id = ${h.invitationId}
    order by l.sequence`;

  return {
    event_name: h.eventName,
    note: h.note,
    display_name: h.displayName,
    pass_code: raw.trim(),
    // Still 200, still carrying the pass: cancelling is reversible, and a
    // guest who opens the link after it is undone should find their
    // invitation intact rather than a 404 they have already been taught to
    // read as "this link is dead".
    cancelled: h.cancelled,
    legs,
  };
}

export async function publicRoutes(app: FastifyInstance) {
  /**
   * One ceiling over everything in this plugin. A token is unguessable, so
   * this is not really about guessing — it is about the cost of the two
   * database round trips each read makes, and about a token that leaks
   * into a WhatsApp group being refreshed by a thousand phones.
   *
   * Encapsulated: this hook applies to the routes registered below and to
   * nothing else in the API. Nothing at the gate is throttled — an usher
   * scanning fast is the system working, and the gate never refuses over
   * anything but a cancelled event.
   */
  app.addHook("onRequest", async (req, reply) => {
    const burst = app.limits.publicPerIp.hit(req.ip);
    if (!burst.ok) {
      return tooMany(reply, burst, "Too many requests. Try again in a moment.");
    }
  });

  app.get<{ Params: { token: string } }>(
    "/public/invitations/:token",
    async (req, reply) => {
      const passId = await verifiedPassId(req.params.token);
      if (!passId) return notFound(reply);

      return asPass(passId, async (db) => {
        const h = await household(db);
        if (!h) return notFound(reply);
        // The household opened its link — the closest thing a wa.me deep
        // link has to a delivery receipt (state machine: never "delivered").
        await db`
          update invitation_deliveries
          set state = 'opened', opened_at = coalesce(opened_at, now())
          where invitation_id = ${h.invitationId} and state = 'link_generated'`;
        return publicInvitation(db, req.params.token, h);
      });
    },
  );

  app.post<{
    Params: { token: string };
    Body: {
      leg_id?: string;
      attending?: boolean;
      count?: number;
      children?: number;
    };
  }>("/public/invitations/:token/rsvp", async (req, reply) => {
    const { leg_id, attending, count, children } = req.body ?? {};
    if (typeof leg_id !== "string" || typeof attending !== "boolean") {
      return reply
        .code(400)
        .send({ code: "bad_request", message: "leg_id and attending are required." });
    }
    for (const [name, v] of [["count", count], ["children", children]] as const) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
        return reply.code(400).send({
          code: "bad_request",
          message: `${name} must be a non-negative integer.`,
        });
      }
    }

    const passId = await verifiedPassId(req.params.token);
    if (!passId) return notFound(reply);

    return asPass(passId, async (db) => {
      const h = await household(db);
      if (!h) return notFound(reply);

      if (h.cancelled) {
        return reply.code(409).send({
          code: "event_cancelled",
          message: "This event has been cancelled.",
        });
      }

      if (h.rsvpDeadline && new Date(h.rsvpDeadline).getTime() + 86_400_000 < Date.now()) {
        return reply
          .code(409)
          .send({ code: "deadline_passed", message: "The reply deadline has passed." });
      }

      // il_public scopes this to the caller's own household, so a forged
      // leg_id belonging to someone else simply finds nothing.
      const [legRow] = await db`
        select allowance from invitation_legs
        where invitation_id = ${h.invitationId} and leg_id = ${leg_id}`;
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

      /**
       * How many of them are children. Caterers price and seat children
       * differently, and asking the household is the only way to know.
       *
       * Left null when the guest does not say, rather than defaulted to
       * zero: "none of us are children" and "nobody asked" are different
       * answers, and only one of them should reach a caterer as a fact.
       * Clamped to the party actually confirmed, so a mis-tap cannot
       * produce more children than people.
       */
      const kids =
        rsvpCount > 0 && children !== undefined
          ? Math.min(children, rsvpCount)
          : null;

      await db`
        update invitation_legs
        set rsvp = ${rsvp}::rsvp_status,
            rsvp_count = ${rsvpCount},
            children = ${kids},
            adults = ${kids === null ? null : rsvpCount - kids},
            responded_at = now()
        where invitation_id = ${h.invitationId} and leg_id = ${leg_id}`;

      return publicInvitation(db, req.params.token, h);
    });
  });
}
