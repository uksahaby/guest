import type { FastifyInstance, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * Everything the RSVP screen shows, in one request.
 *
 * Four counts, a response rate, a cumulative progress line, a breakdown by
 * guest type, a daily trend, and the rows themselves. All of it derived —
 * responded_at is the only clock involved, and it is written when the
 * household replies.
 */

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

async function manages(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db`select app_manages_event(${eventId}) as ok`;
  return Boolean(row?.ok);
}

export async function rsvpRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { eventId: string };
    Querystring: {
      q?: string;
      rsvp?: string;
      category?: string;
      table?: string;
      limit?: string;
      offset?: string;
      days?: string;
    };
  }>(
    "/events/:eventId/rsvps",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) {
          return reply.code(403).send({ code: "forbidden" });
        }

        const q = (req.query.q ?? "").trim();
        const rsvp = (req.query.rsvp ?? "").trim();
        const category = (req.query.category ?? "").trim();
        const table = (req.query.table ?? "").trim();
        const limit = Math.min(Number(req.query.limit ?? 10) || 10, 200);
        const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
        const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 7), 90);

        /**
         * "Pending" and "No response" are the same rsvp value. What tells
         * them apart is whether the household ever opened the invitation:
         * one needs a nudge, the other may never have received it.
         */
        const opened = db`exists (
          select 1 from invitation_deliveries d
          where d.invitation_id = i.id and d.opened_at is not null)`;

        const where = db`
          where i.event_id = ${eventId}
            ${q ? db`and (i.display_name ilike ${"%" + q + "%"}
                          or i.primary_phone like ${"%" + q + "%"}
                          or i.primary_email ilike ${"%" + q + "%"})` : db``}
            ${category ? db`and gc.name = ${category}` : db``}
            ${table ? db`and st.name = ${table}` : db``}
            ${rsvp === "confirmed" ? db`and il.rsvp in ('attending','partial')` : db``}
            ${rsvp === "declined" ? db`and il.rsvp = 'declined'` : db``}
            ${rsvp === "pending" ? db`and il.rsvp = 'pending' and ${opened}` : db``}
            ${rsvp === "no_response" ? db`and il.rsvp = 'pending' and not ${opened}` : db``}`;

        const rows = await db`
          select i.id, i.display_name, i.primary_phone, i.primary_email,
                 i.notes, gc.name as category,
                 il.rsvp, il.rsvp_count, il.allowance, il.responded_at,
                 il.adults, il.children, st.name as table_name,
                 ${opened} as opened
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          left join guest_categories gc on gc.id = i.category_id
          left join seating_tables st on st.id = il.table_id
          ${where}
          order by i.display_name
          limit ${limit} offset ${offset}`;

        const [totalRow] = await db<{ n: number }[]>`
          select count(*)::int as n
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          left join guest_categories gc on gc.id = i.category_id
          left join seating_tables st on st.id = il.table_id
          ${where}`;

        // Event-wide, never page-wide: these are the filter buttons.
        const [counts] = await db`
          select
            count(*)::int as households,
            count(*) filter (where il.rsvp in ('attending','partial'))::int as confirmed,
            count(*) filter (where il.rsvp = 'declined')::int as declined,
            count(*) filter (where il.rsvp = 'pending' and ${opened})::int as pending,
            count(*) filter (where il.rsvp = 'pending' and not ${opened})::int as no_response,
            count(*) filter (where il.responded_at is not null)::int as responded,
            coalesce(sum(il.allowance), 0)::int as invited_people,
            coalesce(sum(il.adults), 0)::int as adults,
            coalesce(sum(il.children), 0)::int as children
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          where i.event_id = ${eventId}`;

        const byType = await db`
          select coalesce(gc.name, 'Uncategorised') as name,
                 count(*)::int as n
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          left join guest_categories gc on gc.id = i.category_id
          where i.event_id = ${eventId} and il.responded_at is not null
          group by 1 order by 2 desc`;

        /**
         * The daily trend, and the cumulative line drawn from it. One
         * query rather than two: the progress chart is the running total
         * of the same series, and computing it twice in SQL is how the
         * two charts end up disagreeing by a row.
         */
        const trend = await db`
          select d::date as day,
                 coalesce(count(il.invitation_id), 0)::int as n
          from generate_series(
                 current_date - ${days - 1}::int, current_date, interval '1 day'
               ) d
          left join invitation_legs il
            on il.responded_at >= d and il.responded_at < d + interval '1 day'
           and il.invitation_id in (
                 select id from invitations where event_id = ${eventId})
          group by d order by d`;

        const categories = await db`
          select distinct gc.name from invitations i
          join guest_categories gc on gc.id = i.category_id
          where i.event_id = ${eventId} order by gc.name`;

        const tables = await db`
          select st.name from seating_tables st
          join event_legs l on l.id = st.leg_id
          where l.event_id = ${eventId} order by st.name`;

        return {
          rows,
          total: totalRow!.n,
          limit,
          offset,
          counts,
          by_type: byType,
          trend,
          categories: categories.map((c) => c.name),
          tables: tables.map((t) => t.name),
        };
      }),
  );
}
