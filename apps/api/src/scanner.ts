import type { FastifyInstance } from "fastify";
import { sql } from "./db.ts";

/**
 * Scanner-facing routes.
 *
 * /scanner/legs/:legId/bootstrap is the only endpoint in the whole API that
 * ever returns an event signing key, and only to a user holding a
 * staff_assignment on that leg. The device downloads keys for EVERY event
 * its ushers work (phase-4c §2) so a pass from another wedding can be named
 * instead of shrugged at as invalid.
 */

export async function scannerRoutes(app: FastifyInstance) {
  app.get("/scanner/assignments", { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    return sql`
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
      where sa.user_id = ${userId}
      order by l.starts_at`;
  });

  app.get<{ Params: { legId: string }; Querystring: { since?: string } }>(
    "/scanner/legs/:legId/bootstrap",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const { legId } = req.params;
      // `since` is accepted for forward compatibility; v1 always returns the
      // full payload. Correct on every reconnect, just not yet minimal.

      const assigned = await sql`
        select 1 from staff_assignments
        where user_id = ${userId} and leg_id = ${legId}`;
      if (assigned.length === 0) {
        return reply.code(403).send({ code: "forbidden", message: "No assignment on this leg." });
      }

      const [leg] = await sql`
        select l.event_id, e.name, e.allow_overflow, e.require_rsvp, e.allow_walkins
        from event_legs l join events e on e.id = l.event_id
        where l.id = ${legId}`;
      if (!leg) {
        return reply.code(404).send({ code: "not_found", message: "No such leg." });
      }

      const [keys, entrances, invitations, revoked] = await Promise.all([
        // Every event this usher is assigned to — not only the current one.
        sql`
          select distinct e.id as event_id, e.name as event_name,
                 e.token_version, e.signing_key
          from staff_assignments sa
          join event_legs l on l.id = sa.leg_id
          join events e     on e.id = l.event_id
          where sa.user_id = ${userId}`,
        sql`
          select id, name, is_active from entrances
          where leg_id = ${legId} order by name`,
        sql`
          select
            p.id as pass_id,
            i.display_name,
            gc.name as category,
            st.name as table_name,
            il.allowance,
            coalesce(adm.n, 0) as admitted,
            il.rsvp,
            concat_ws(' ', i.display_name, i.primary_phone) as search_terms
          from invitation_legs il
          join invitations i on i.id = il.invitation_id
          join passes p      on p.invitation_id = i.id
          left join guest_categories gc on gc.id = i.category_id
          left join seating_tables st   on st.id = il.table_id
          left join lateral (
            select sum(c.admitted_count)::int as n
            from check_in_events c
            where c.pass_id = p.id and c.leg_id = il.leg_id
              and c.result in ('admitted','partial','manual','overflow_admitted','re_entry','reversal')
          ) adm on true
          where il.leg_id = ${legId}
          order by i.display_name`,
        sql`
          select p.id from passes p
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
    },
  );

  // Readiness check 8: has this usher ever actually opened the scanner?
  app.post<{ Params: { legId: string } }>(
    "/scanner/legs/:legId/test",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const updated = await sql`
        update staff_assignments set last_tested_at = now()
        where user_id = ${userId} and leg_id = ${req.params.legId}
        returning id`;
      if (updated.length === 0) {
        return reply.code(403).send({ code: "forbidden", message: "No assignment on this leg." });
      }
      return reply.code(204).send();
    },
  );
}
