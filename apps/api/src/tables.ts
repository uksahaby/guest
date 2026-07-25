import type { FastifyInstance } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * Seating. Tables belong to a LEG, not an event — the traditional in Abuja
 * and the white wedding in Lagos seat different rooms, and a household can
 * sit at Table 12 at one and Table 4 at the other.
 *
 * A seat is a PERSON, so a household of four occupies four seats. Counting
 * households instead would put a party of six on a table of ten and call it
 * nearly empty.
 *
 * Nothing here blocks anything: a table can be over capacity, and the UI
 * says so rather than refusing. Same reasoning as the gate — the software
 * flags, the organiser decides.
 */

type Sendable = { code: number; body: unknown };
const FORBIDDEN: Sendable = {
  code: 403,
  body: { code: "forbidden", message: "Not your event." },
};

const MAX_TABLES = 500;
const MAX_CAPACITY = 100;

async function managesLeg(db: Db, legId: string): Promise<boolean> {
  const [row] = await db`select app_manages_leg(${legId}::uuid) as ok`;
  return row?.ok === true;
}

/** Tables with who is on them and how many seats that takes. */
async function seatingFor(db: Db, legId: string) {
  const tables = await db`
    select
      st.id, st.name, st.capacity,
      coalesce(sum(il.allowance), 0)::int as seats_used,
      count(il.invitation_id)::int        as households,
      coalesce(
        array_agg(i.display_name order by i.display_name)
          filter (where i.display_name is not null),
        '{}'
      ) as who
    from seating_tables st
    left join invitation_legs il on il.table_id = st.id
    left join invitations i      on i.id = il.invitation_id
    where st.leg_id = ${legId}
    group by st.id, st.name, st.capacity
    order by st.name`;

  const [unseated] = await db`
    select
      count(*)::int                       as households,
      coalesce(sum(il.allowance), 0)::int as people
    from invitation_legs il
    where il.leg_id = ${legId} and il.table_id is null`;

  const [totals] = await db`
    select
      coalesce(sum(st.capacity), 0)::int as capacity,
      count(*)::int                      as tables
    from seating_tables st where st.leg_id = ${legId}`;

  return {
    leg_id: legId,
    tables: tables.map((t) => ({
      ...t,
      over_capacity: t.seats_used > t.capacity,
    })),
    total_tables: totals!.tables,
    total_capacity: totals!.capacity,
    seated_people: tables.reduce((n, t) => n + t.seats_used, 0),
    unseated_households: unseated!.households,
    unseated_people: unseated!.people,
  };
}

export async function tableRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  // ---- the seating plan ---------------------------------------------------

  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/tables",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        if (!(await managesLeg(db, req.params.legId))) return FORBIDDEN;
        return { code: 200, body: await seatingFor(db, req.params.legId) };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  /** Households not yet seated — what the organiser is working through. */
  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/unseated",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        if (!(await managesLeg(db, req.params.legId))) return FORBIDDEN;
        const rows = await db`
          select i.id as invitation_id, i.display_name, il.allowance,
                 gc.name as category, il.rsvp
          from invitation_legs il
          join invitations i on i.id = il.invitation_id
          left join guest_categories gc on gc.id = i.category_id
          where il.leg_id = ${req.params.legId} and il.table_id is null
          order by i.display_name`;
        return { code: 200, body: { data: rows } };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  // ---- creating tables ----------------------------------------------------

  app.post<{
    Params: { legId: string };
    Body: { name?: string; capacity?: number; count?: number; prefix?: string };
  }>(
    "/legs/:legId/tables",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const capacity = Number.isInteger(b.capacity) ? Number(b.capacity) : 10;
      if (capacity < 1 || capacity > MAX_CAPACITY) {
        return reply.code(400).send({
          code: "bad_capacity",
          message: `Seats per table must be between 1 and ${MAX_CAPACITY}.`,
        });
      }

      // Two shapes: one named table, or a numbered run. "42 tables of 10"
      // is the setup flow's own example, and nobody types that 42 times.
      const count = Number.isInteger(b.count) ? Number(b.count) : null;
      if (count !== null && (count < 1 || count > MAX_TABLES)) {
        return reply.code(400).send({
          code: "bad_count",
          message: `Create between 1 and ${MAX_TABLES} tables at a time.`,
        });
      }
      if (count === null && !b.name?.trim()) {
        return reply.code(400).send({
          code: "bad_request",
          message: "Give the table a name, or a count to create several.",
        });
      }

      const prefix = (b.prefix ?? "Table").trim() || "Table";
      const name = b.name?.trim();

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { legId } = req.params;
        if (!(await managesLeg(db, legId))) return FORBIDDEN;

        const [existing] = await db`
          select count(*)::int as n from seating_tables where leg_id = ${legId}`;
        const wanted = count ?? 1;
        if (existing!.n + wanted > MAX_TABLES) {
          return {
            code: 400,
            body: {
              code: "too_many_tables",
              message: `That would be more than ${MAX_TABLES} tables at this leg.`,
            },
          };
        }

        let created = 0;
        if (count === null) {
          const rows = await db`
            insert into seating_tables (leg_id, name, capacity)
            values (${legId}, ${name!}, ${capacity})
            on conflict (leg_id, name) do nothing
            returning id`;
          created = rows.length;
        } else {
          // Numbering continues past whatever is already there, so adding
          // ten more tables doesn't collide with Table 1–42.
          for (let n = 1, made = 0; made < count && n <= MAX_TABLES * 2; n++) {
            const rows = await db`
              insert into seating_tables (leg_id, name, capacity)
              values (${legId}, ${`${prefix} ${n}`}, ${capacity})
              on conflict (leg_id, name) do nothing
              returning id`;
            if (rows.length > 0) made++, created++;
          }
        }

        // Tables only mean anything if the leg admits it has them.
        if (created > 0) {
          await db`update event_legs set tables_enabled = true where id = ${legId}`;
        }

        return {
          code: 201,
          body: { created, ...(await seatingFor(db, legId)) },
        };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  // ---- editing and removing -----------------------------------------------

  app.patch<{
    Params: { tableId: string };
    Body: { name?: string; capacity?: number };
  }>(
    "/tables/:tableId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const name = b.name?.trim();
      const capacity = b.capacity;
      if (capacity !== undefined &&
          (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY)) {
        return reply.code(400).send({
          code: "bad_capacity",
          message: `Seats must be between 1 and ${MAX_CAPACITY}.`,
        });
      }
      if (!name && capacity === undefined) {
        return reply.code(400).send({
          code: "bad_request",
          message: "Nothing to change.",
        });
      }

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [table] = await db`
          select leg_id from seating_tables where id = ${req.params.tableId}`;
        if (!table || !(await managesLeg(db, table.leg_id))) return FORBIDDEN;

        const updated = await db`
          update seating_tables
          set name = coalesce(${name ?? null}, name),
              capacity = coalesce(${capacity ?? null}, capacity)
          where id = ${req.params.tableId}
          returning id, name, capacity`;
        return { code: 200, body: updated[0] };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.delete<{ Params: { tableId: string } }>(
    "/tables/:tableId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [table] = await db`
          select leg_id from seating_tables where id = ${req.params.tableId}`;
        if (!table || !(await managesLeg(db, table.leg_id))) return FORBIDDEN;

        // The households stay on the guest list; they simply lose a seat.
        // (The FK is ON DELETE SET NULL, so this is belt to that brace.)
        await db`
          update invitation_legs set table_id = null
          where table_id = ${req.params.tableId}`;
        await db`delete from seating_tables where id = ${req.params.tableId}`;
        return { code: 204, body: null };
      });
      return out.code === 204 ? reply.code(204).send() : reply.code(out.code).send(out.body);
    },
  );

  // ---- seating a household ------------------------------------------------
  //
  // The contract's PUT /invitations/{id}/legs/{legId}: what this household
  // is entitled to at this leg, and where it sits.

  app.put<{
    Params: { invitationId: string; legId: string };
    Body: { allowance?: number; table_id?: string | null };
  }>(
    "/invitations/:invitationId/legs/:legId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const allowance = b.allowance;
      if (allowance !== undefined &&
          (!Number.isInteger(allowance) || allowance < 1)) {
        return reply.code(400).send({
          code: "bad_allowance",
          message: "An invitation admits at least one person.",
        });
      }
      const hasTable = Object.hasOwn(b, "table_id");

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { invitationId, legId } = req.params;
        if (!(await managesLeg(db, legId))) return FORBIDDEN;

        // A table from another leg would seat someone in the wrong room.
        if (hasTable && b.table_id) {
          const [table] = await db`
            select id from seating_tables
            where id = ${b.table_id} and leg_id = ${legId}`;
          if (!table) {
            return {
              code: 400,
              body: {
                code: "wrong_leg_table",
                message: "That table belongs to a different part of the event.",
              },
            };
          }
        }

        const updated = await db`
          update invitation_legs
          set allowance = coalesce(${allowance ?? null}, allowance),
              table_id = ${hasTable ? (b.table_id ?? null) : db`table_id`}
          where invitation_id = ${invitationId} and leg_id = ${legId}
          returning leg_id, allowance, table_id, rsvp, rsvp_count`;

        if (updated.length === 0) {
          return {
            code: 404,
            body: {
              code: "not_invited",
              message: "That household isn't invited to this part of the event.",
            },
          };
        }
        return { code: 200, body: updated[0] };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.delete<{ Params: { invitationId: string; legId: string } }>(
    "/invitations/:invitationId/legs/:legId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { invitationId, legId } = req.params;
        if (!(await managesLeg(db, legId))) return FORBIDDEN;
        await db`
          delete from invitation_legs
          where invitation_id = ${invitationId} and leg_id = ${legId}`;
        return { code: 204, body: null };
      });
      return out.code === 204 ? reply.code(204).send() : reply.code(out.code).send(out.body);
    },
  );
}
