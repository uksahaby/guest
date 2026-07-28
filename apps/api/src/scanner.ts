import type { FastifyInstance } from "fastify";
import { asUser, sqlUsher } from "./db.ts";

/**
 * Scanner-facing routes. Every query runs as app_usher, which by grant
 * cannot read invitations.primary_phone, invitations.primary_email or
 * events.signing_key, and by policy sees only legs the usher is actually
 * assigned to (db/migrations/003_rls.sql).
 *
 * The two things a gate legitimately needs from those withheld columns
 * come through owner-rights views that emit nothing else:
 *
 *   usher_event_keys  — signing keys for this usher's events, so a pass
 *                       from another wedding can be named rather than
 *                       dismissed as a forgery (phase-4c §2)
 *   usher_guest_list  — the leg's households, with the LAST FOUR DIGITS
 *                       of a phone number for search instead of the
 *                       number itself. An usher can confirm a number read
 *                       aloud to them; they cannot harvest a guest list.
 */

export async function scannerRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  app.get("/scanner/assignments", { preHandler: [app.authenticate] }, async (req) =>
    asUser(sqlUsher, uid(req), async (db) => {
      // sa_self limits this to the caller's own assignments — an usher
      // never sees the rest of the roster.
      return db`
        select
          sa.leg_id,
          l.name  as leg_name,
          e.name  as event_name,
          l.starts_at,
          l.venue_name,
          sa.entrance_id,
          (select count(*)::int from invitation_legs il where il.leg_id = l.id) as guest_count,
          (e.status = 'active') as is_open
        from staff_assignments sa
        join event_legs l on l.id = sa.leg_id
        join events e     on e.id = l.event_id
        order by l.starts_at`;
    }),
  );

  app.get<{ Params: { legId: string }; Querystring: { since?: string } }>(
    "/scanner/legs/:legId/bootstrap",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlUsher, uid(req), async (db) => {
        const { legId } = req.params;
        // `since` is accepted for forward compatibility; v1 always returns
        // the full payload. Correct on every reconnect, just not minimal.

        const [assigned] = await db`select app_works_leg(${legId}::uuid) as ok`;
        if (assigned?.ok !== true) {
          return reply
            .code(403)
            .send({ code: "forbidden", message: "No assignment on this leg." });
        }

        const [leg] = await db`
          select l.event_id, e.name, e.allow_overflow, e.require_rsvp,
                 e.allow_walkins, e.status, e.manager_phone
          from event_legs l join events e on e.id = l.event_id
          where l.id = ${legId}`;
        if (!leg) {
          return reply.code(404).send({ code: "not_found", message: "No such leg." });
        }

        const [keys, entrances, invitations, revoked] = await Promise.all([
          db`select event_id, event_name, token_version, signing_key
             from usher_event_keys`,
          db`select id, name, is_active from entrances
             where leg_id = ${legId} order by name`,
          db`select pass_id, display_name, category, table_name, allowance,
                    admitted, rsvp, search_terms
             from usher_guest_list
             where leg_id = ${legId} order by display_name`,
          db`select p.id from passes p
             join event_legs l on l.event_id = p.event_id
             where l.id = ${legId} and p.status = 'revoked'`,
        ]);

        return {
          synced_at: new Date().toISOString(),
          event: {
            id: leg.event_id,
            name: leg.name,
            allow_overflow: leg.allow_overflow,
            require_rsvp: leg.require_rsvp,
            allow_walkins: leg.allow_walkins,
            // The gate refuses everything when this is true, offline
            // included — which is why it rides in the payload rather than
            // being checked only on the server.
            cancelled: leg.status === "cancelled",
            // Who "Call manager" dials. Carried offline like everything
            // else the gate needs — the moment you need it is the moment
            // the signal is gone.
            manager_phone: leg.manager_phone,
          },
          keys: keys.map((k) => ({
            event_id: k.event_id,
            event_name: k.event_name,
            token_version: k.token_version,
            key: Buffer.from(k.signing_key).toString("base64"),
          })),
          entrances,
          invitations,
          revoked_pass_ids: revoked.map((r) => r.id),
        };
      }),
  );

  // Readiness check 8: has this usher ever actually opened the scanner?
  app.post<{ Params: { legId: string } }>(
    "/scanner/legs/:legId/test",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlUsher, uid(req), async (db) => {
        // sa_self_test allows an usher to touch only their own row.
        const updated = await db`
          update staff_assignments set last_tested_at = now()
          where leg_id = ${req.params.legId}
          returning id`;
        if (updated.length === 0) {
          return reply
            .code(403)
            .send({ code: "forbidden", message: "No assignment on this leg." });
        }
        return reply.code(204).send();
      }),
  );
}
