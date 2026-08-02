import type { FastifyInstance, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * The seating screen: the tables, the plan, and who is still standing.
 *
 * Everything is counted from invitation_legs.table_id. There is no stored
 * "seats assigned" anywhere — a number that has to be kept in step with
 * the thing it counts eventually is not.
 */

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

async function managesLeg(db: Db, legId: string): Promise<boolean> {
  const [row] = await db`select app_manages_leg(${legId}) as ok`;
  return Boolean(row?.ok);
}

/** The leg an event seats at. Single-venue events have exactly one. */
async function firstLeg(db: Db, eventId: string): Promise<string | null> {
  const [leg] = await db`
    select id from event_legs where event_id = ${eventId}
    order by starts_at limit 1`;
  return leg?.id ?? null;
}

export async function seatingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/seating",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const legId = await firstLeg(db, req.params.eventId);
        if (!legId || !(await managesLeg(db, legId))) {
          return reply.code(404).send({ code: "not_found" });
        }

        const tables = await db`
          select t.id, t.name, t.kind, t.capacity, t.is_active,
                 t.pos_x, t.pos_y,
                 coalesce((
                   select sum(il.allowance)::int from invitation_legs il
                   where il.table_id = t.id
                 ), 0) as assigned,
                 coalesce((
                   select count(*)::int from invitation_legs il
                   where il.table_id = t.id
                 ), 0) as households
          from seating_tables t
          where t.leg_id = ${legId}
          order by t.name`;

        /**
         * Only confirmed households need a seat. Chasing a table for
         * somebody who has not replied — or has declined — is how an
         * organiser ends up seating a room that never arrives.
         */
        const unassigned = await db`
          select i.id, i.display_name, il.allowance, il.rsvp,
                 gc.name as category
          from invitation_legs il
          join invitations i on i.id = il.invitation_id
          left join guest_categories gc on gc.id = i.category_id
          where il.leg_id = ${legId}
            and il.table_id is null
            and il.rsvp in ('attending','partial')
          order by i.display_name`;

        const [totals] = await db`
          select
            count(*)::int as tables,
            count(*) filter (where is_active)::int as active,
            count(*) filter (where not is_active)::int as inactive,
            coalesce(sum(capacity) filter (where is_active), 0)::int as seats
          from seating_tables where leg_id = ${legId}`;

        const [seated] = await db`
          select coalesce(sum(il.allowance), 0)::int as people
          from invitation_legs il
          join seating_tables t on t.id = il.table_id
          where il.leg_id = ${legId}`;

        const unseatedPeople = unassigned.reduce(
          (n, r) => n + Number(r.allowance ?? 0),
          0,
        );

        return {
          leg_id: legId,
          tables,
          unassigned,
          totals: {
            tables: totals!.tables,
            active: totals!.active,
            inactive: totals!.inactive,
            seats: totals!.seats,
            assigned: seated!.people,
            empty: Math.max(0, totals!.seats - seated!.people),
            unseated_people: unseatedPeople,
            unseated_households: unassigned.length,
          },
        };
      }),
  );

  /** Where a table sits on the plan, after a drag. */
  app.patch<{
    Params: { tableId: string };
    Body: { pos_x?: number; pos_y?: number; kind?: string; is_active?: boolean };
  }>(
    "/tables/:tableId/plan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const clamp = (n: number) => Math.max(0, Math.min(100, n));

      const ok = await asUser(sqlRw, uid(req), async (db: Db) => {
        // RLS decides ownership; an update that is not theirs touches no
        // rows and says so by returning none.
        const rows = await db`
          update seating_tables set
            pos_x = ${b.pos_x === undefined ? null : clamp(b.pos_x)},
            pos_y = ${b.pos_y === undefined ? null : clamp(b.pos_y)},
            kind = coalesce(${b.kind ?? null}, kind),
            is_active = coalesce(${b.is_active ?? null}, is_active)
          where id = ${req.params.tableId}
          returning id`;
        return rows.length > 0;
      });

      if (!ok) return reply.code(404).send({ code: "not_found" });
      return reply.code(204).send();
    },
  );

  /**
   * Seat everyone who has replied yes and has nowhere to sit.
   *
   * The rule an organiser actually wants: keep a household together, fill
   * the fullest table that still has room, and never split a party across
   * two tables. Largest households first, because a party of six placed
   * last has nowhere left that fits it.
   *
   * Deliberately additive — it never moves someone already seated. An
   * organiser who has hand-placed the couple's parents will not forgive a
   * button that reshuffles them.
   */
  app.post<{ Params: { eventId: string } }>(
    "/events/:eventId/seating/auto",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const legId = await firstLeg(db, req.params.eventId);
        if (!legId || !(await managesLeg(db, legId))) {
          return reply.code(404).send({ code: "not_found" });
        }

        const tables = await db`
          select t.id, t.capacity,
                 coalesce((
                   select sum(il.allowance)::int from invitation_legs il
                   where il.table_id = t.id
                 ), 0) as used
          from seating_tables t
          where t.leg_id = ${legId} and t.is_active
          order by t.name`;

        const waiting = await db`
          select il.invitation_id, il.allowance
          from invitation_legs il
          where il.leg_id = ${legId} and il.table_id is null
            and il.rsvp in ('attending','partial')
          order by il.allowance desc`;

        const room = tables.map((t) => ({
          id: t.id as string,
          free: Number(t.capacity) - Number(t.used),
        }));

        let seated = 0;
        for (const party of waiting) {
          const size = Number(party.allowance);
          // Tightest fit that still holds them: leaves the roomy tables
          // for the parties that will need them.
          const pick = room
            .filter((t) => t.free >= size)
            .sort((a, b) => a.free - b.free)[0];
          if (!pick) continue;

          await db`
            update invitation_legs set table_id = ${pick.id}
            where invitation_id = ${party.invitation_id} and leg_id = ${legId}`;
          pick.free -= size;
          seated += 1;
        }

        return { seated, still_waiting: waiting.length - seated };
      }),
  );
}
