import type { FastifyInstance, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";
import { eventSummary } from "./summary.ts";

/**
 * The organiser's home screen, and the per-event overview.
 *
 * Both are one request each. A dashboard that fires nine queries from the
 * browser looks broken on Nigerian mobile data — panels landing one at a
 * time, the layout jumping as they arrive.
 *
 * Every figure is a query. Nothing here is a stored counter that can drift
 * from the thing it counts, and no panel invents a number to fill itself:
 * where there is nothing yet, the screen says so.
 */

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/dashboard",
    { preHandler: [app.authenticate] },
    async (req) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        // RLS scopes this to the caller's workspaces; no filter is needed
        // here, and none would be trusted if it were.
        const events = await db`
          select e.id, e.name, e.status, e.plan, e.people_limit,
                 e.cover_image_url,
                 (select min(starts_at) from event_legs where event_id = e.id)
                   as starts_at
          from events e
          order by (select min(starts_at) from event_legs where event_id = e.id)
                   nulls last`;

        const [me] = await db`
          select full_name from users where id = ${uid(req)}`;

        // The featured event is the next one that has not happened, and
        // failing that the most recent — an organiser between weddings
        // should see the one just gone rather than an empty page.
        const now = Date.now();
        const upcoming = events.filter(
          (e) => e.starts_at && new Date(e.starts_at).getTime() >= now,
        );
        const featured = upcoming[0] ?? events[events.length - 1] ?? null;

        const list = events.map((e) => ({
          id: e.id,
          name: e.name,
          starts_at: e.starts_at,
          status: e.status,
        }));

        if (!featured) {
          return {
            organiser: me?.full_name ?? null,
            events: [],
            featured: null,
            totals: null,
            rsvp: null,
            readiness: null,
            activity: [],
          };
        }

        const s = await eventSummary(db, featured.id, featured.people_limit);

        return {
          organiser: me?.full_name ?? null,
          events: list,
          featured: {
            id: featured.id,
            name: featured.name,
            cover_image_url: featured.cover_image_url,
            starts_at: s.leg?.starts_at ?? null,
            venue_name: s.leg?.venue_name ?? null,
            plan: featured.plan,
            days_until: s.days_until,
            tables: s.tables,
          },
          totals: s.totals,
          rsvp: s.rsvp,
          readiness: s.readiness,
          activity: s.activity,
        };
      }),
  );

  /**
   * The same picture for one named event — what the sidebar's Overview
   * points at.
   *
   * Separate from GET /events/:id, which is the plain record. This is the
   * summary, and it costs enough queries to be asked for only when a
   * screen actually wants it.
   */
  app.get<{ Params: { id: string } }>(
    "/events/:id/overview",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const [event] = await db`
          select id, name, status, plan, people_limit, cover_image_url,
                 event_type
          from events where id = ${req.params.id}`;
        // RLS returns nothing rather than refusing, so "gone" and "not
        // yours" look identical here. That is the intended answer.
        if (!event) return reply.code(404).send({ code: "not_found" });

        const s = await eventSummary(db, event.id, event.people_limit);

        return {
          event: {
            id: event.id,
            name: event.name,
            event_type: event.event_type,
            status: event.status,
            plan: event.plan,
            cover_image_url: event.cover_image_url,
            starts_at: s.leg?.starts_at ?? null,
            venue_name: s.leg?.venue_name ?? null,
            leg_id: s.leg?.id ?? null,
            leg_name: s.leg?.name ?? null,
            days_until: s.days_until,
          },
          counts: {
            tables: s.tables,
            entrances: s.entrances,
            staff: s.staff,
          },
          totals: s.totals,
          rsvp: s.rsvp,
          readiness: s.readiness,
          activity: s.activity,
        };
      }),
  );
}
