import type { FastifyInstance, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * QR passes: who has one, whether it reached them, and who has walked in.
 *
 * A pass exists for every household from the moment it is imported — the
 * QR is derived from the pass id and the event's signing key, so there is
 * nothing to "generate" in the sense of creating an image. What is
 * generated is the LINK, which is what a guest actually receives, and that
 * is what these states track.
 */

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

const ADMITTING = [
  "admitted", "partial", "manual", "overflow_admitted", "re_entry",
];

async function manages(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db`select app_manages_event(${eventId}) as ok`;
  return Boolean(row?.ok);
}

export async function passRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { eventId: string };
    Querystring: {
      q?: string;
      status?: string;
      table?: string;
      category?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    "/events/:eventId/passes",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) {
          return reply.code(403).send({ code: "forbidden" });
        }

        const q = (req.query.q ?? "").trim();
        const status = (req.query.status ?? "").trim();
        const table = (req.query.table ?? "").trim();
        const category = (req.query.category ?? "").trim();
        const limit = Math.min(Number(req.query.limit ?? 10) || 10, 200);
        const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);

        /**
         * Four states, and they are about the LINK rather than the image:
         *
         *   not_sent   no link has ever been made
         *   generated  a link exists but was never marked as sent
         *   sent       it went out
         *   opened     the household opened it, which is the first moment
         *              anyone can say it truly arrived
         */
        const gen = db`exists (select 1 from invitation_deliveries d
          where d.invitation_id = i.id and d.generated_at is not null)`;
        const snt = db`exists (select 1 from invitation_deliveries d
          where d.invitation_id = i.id and d.sent_at is not null)`;
        const opn = db`exists (select 1 from invitation_deliveries d
          where d.invitation_id = i.id and d.opened_at is not null)`;
        const inn = db`exists (select 1 from check_in_events c
          join passes p2 on p2.id = c.pass_id
          where p2.invitation_id = i.id and c.result in ${db(ADMITTING)})`;

        const where = db`
          where i.event_id = ${eventId}
            ${q ? db`and (i.display_name ilike ${"%" + q + "%"}
                          or i.primary_phone like ${"%" + q + "%"}
                          or i.primary_email ilike ${"%" + q + "%"})` : db``}
            ${category ? db`and gc.name = ${category}` : db``}
            ${table ? db`and st.name = ${table}` : db``}
            ${status === "not_sent" ? db`and not ${gen}` : db``}
            ${status === "generated" ? db`and ${gen} and not ${snt}` : db``}
            ${status === "sent" ? db`and ${snt} and not ${opn}` : db``}
            ${status === "opened" ? db`and ${opn}` : db``}
            ${status === "checked_in" ? db`and ${inn}` : db``}
            ${status === "not_checked_in" ? db`and not ${inn}` : db``}`;

        const rows = await db`
          select i.id, i.display_name, i.primary_phone, i.primary_email,
                 gc.name as category, st.name as table_name,
                 il.allowance,
                 p.id as pass_id,
                 ${gen} as generated, ${snt} as sent, ${opn} as opened,
                 (select max(c.scanned_at) from check_in_events c
                  join passes p2 on p2.id = c.pass_id
                  where p2.invitation_id = i.id
                    and c.result in ${db(ADMITTING)}) as checked_in_at
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          left join passes p on p.invitation_id = i.id
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

        // Event-wide, because the cards are the filters.
        const [counts] = await db`
          select
            count(*)::int as total,
            count(*) filter (where ${gen})::int as generated,
            count(*) filter (where ${snt})::int as sent,
            count(*) filter (where ${inn})::int as checked_in,
            count(*) filter (where not ${inn})::int as not_checked_in,
            count(*) filter (where ${gen} and not ${snt})::int as pending,
            count(*) filter (where not ${gen})::int as not_sent
          from invitations i where i.event_id = ${eventId}`;

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
          categories: categories.map((c) => c.name),
          tables: tables.map((t) => t.name),
        };
      }),
  );
}
