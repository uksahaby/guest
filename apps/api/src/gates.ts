import type { FastifyInstance, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * Gates and teams: the entry points, who is on them, and what went wrong.
 *
 * Counts come from check_in_events, membership from staff_assignments.
 * "Active now" means someone whose scanner has actually been used today —
 * a roster says who was asked to come, and only a scan says who did.
 */

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

const ADMITTING = [
  "admitted", "partial", "manual", "overflow_admitted", "re_entry",
];

async function manages(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db`select app_manages_event(${eventId}) as ok`;
  return Boolean(row?.ok);
}

export async function gateRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/gates",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) {
          return reply.code(403).send({ code: "forbidden" });
        }

        const gates = await db`
          select en.id, en.name, en.location, en.is_active,
                 coalesce((
                   select sum(c.admitted_count)::int from check_in_events c
                   where c.entrance_id = en.id
                     and c.result in ${db(ADMITTING)}
                 ), 0) as admitted,
                 (select max(c.scanned_at) from check_in_events c
                  where c.entrance_id = en.id) as last_seen_at,
                 (select count(*)::int from staff_assignments s
                  where s.entrance_id = en.id) as staff,
                 (select t.name from teams t where t.entrance_id = en.id
                  limit 1) as team_name,
                 (select count(*)::int from staff_assignments s
                  join teams t on t.id = s.team_id
                  where t.entrance_id = en.id) as team_members
          from entrances en
          join event_legs l on l.id = en.leg_id
          where l.event_id = ${eventId}
          order by en.is_active desc, en.name`;

        const teams = await db`
          select t.id, t.name, t.description, t.role, t.is_active,
                 t.entrance_id, en.name as entrance_name,
                 u.id as lead_id, u.full_name as lead_name,
                 u.email as lead_email, u.phone as lead_phone,
                 (select count(*)::int from staff_assignments s
                  where s.team_id = t.id) as members,
                 (select count(distinct s.user_id)::int
                  from staff_assignments s
                  join check_in_events c on c.staff_user_id = s.user_id
                  where s.team_id = t.id
                    and c.scanned_at >= date_trunc('day', now())) as on_duty
          from teams t
          left join users u on u.id = t.lead_user_id
          left join entrances en on en.id = t.entrance_id
          where t.event_id = ${eventId}
          order by t.name`;

        /**
         * Everyone assigned to a gate on this event, whether or not they
         * are on a team. A single-gate wedding has no teams at all and
         * must still show its ushers.
         */
        const staff = await db`
          select u.id, u.full_name, u.phone, u.email,
                 s.entrance_id, en.name as entrance_name,
                 s.team_id, t.name as team_name,
                 s.last_tested_at,
                 (select max(c.scanned_at) from check_in_events c
                  where c.staff_user_id = u.id) as last_scan_at
          from staff_assignments s
          join users u on u.id = s.user_id
          join event_legs l on l.id = s.leg_id
          left join entrances en on en.id = s.entrance_id
          left join teams t on t.id = s.team_id
          where l.event_id = ${eventId}
          order by u.full_name`;

        const incidents = await db`
          select i.id, i.kind, i.note, i.created_at, i.resolved_at,
                 en.name as entrance_name, u.full_name as reported_by
          from incidents i
          left join entrances en on en.id = i.entrance_id
          left join users u on u.id = i.reported_by
          where i.event_id = ${eventId}
          order by i.created_at desc
          limit 20`;

        const [totals] = await db`
          select
            (select count(*)::int from entrances en
             join event_legs l on l.id = en.leg_id
             where l.event_id = ${eventId}) as gates,
            (select count(*)::int from entrances en
             join event_legs l on l.id = en.leg_id
             where l.event_id = ${eventId} and en.is_active) as gates_active,
            (select count(*)::int from staff_assignments s
             join event_legs l on l.id = s.leg_id
             where l.event_id = ${eventId}) as members,
            -- On duty is evidence, not a roster: someone whose scanner has
            -- been used today. A list of who was asked to come is not a
            -- list of who came.
            (select count(distinct c.staff_user_id)::int
             from check_in_events c
             join event_legs l on l.id = c.leg_id
             where l.event_id = ${eventId}
               and c.scanned_at >= date_trunc('day', now())) as on_duty,
            (select coalesce(sum(c.admitted_count), 0)::int
             from check_in_events c
             join event_legs l on l.id = c.leg_id
             where l.event_id = ${eventId}
               and c.result in ${db(ADMITTING)}
               and c.scanned_at >= date_trunc('day', now())) as today,
            (select count(*)::int from incidents
             where event_id = ${eventId} and resolved_at is null) as open_incidents,
            (select count(*)::int from incidents
             where event_id = ${eventId}) as all_incidents`;

        return { gates, teams, staff, incidents, totals };
      }),
  );

  app.post<{
    Params: { eventId: string };
    Body: { name?: string; description?: string; role?: string;
            lead_user_id?: string; entrance_id?: string };
  }>(
    "/events/:eventId/teams",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const name = (b.name ?? "").trim();
      if (!name) {
        return reply.code(400).send({ code: "bad_name", message: "A team needs a name." });
      }

      const out = await asUser(sqlRw, uid(req), async (db: Db) => {
        if (!(await manages(db, req.params.eventId))) return null;
        const [row] = await db`
          insert into teams (event_id, name, description, role,
                             lead_user_id, entrance_id)
          values (${req.params.eventId}, ${name},
                  ${b.description?.trim() || null},
                  ${b.role || "gate_staff"},
                  ${b.lead_user_id || null}, ${b.entrance_id || null})
          on conflict (event_id, name) do nothing
          returning id`;
        return row ?? null;
      });

      if (!out) {
        return reply.code(409).send({
          code: "team_exists",
          message: "A team with that name already exists.",
        });
      }
      return reply.code(201).send(out);
    },
  );

  /** Note something that happened at a gate. */
  app.post<{
    Params: { eventId: string };
    Body: { note?: string; kind?: string; entrance_id?: string };
  }>(
    "/events/:eventId/incidents",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const note = (req.body?.note ?? "").trim();
      if (!note) {
        return reply.code(400).send({
          code: "bad_note",
          message: "Say what happened.",
        });
      }

      const out = await asUser(sqlRw, uid(req), async (db: Db) => {
        if (!(await manages(db, req.params.eventId))) return null;
        const [row] = await db`
          insert into incidents (event_id, entrance_id, reported_by, kind, note)
          values (${req.params.eventId}, ${req.body?.entrance_id || null},
                  ${uid(req)}, ${req.body?.kind || "other"}, ${note})
          returning id`;
        return row ?? null;
      });

      if (!out) return reply.code(403).send({ code: "forbidden" });
      return reply.code(201).send(out);
    },
  );

  app.post<{ Params: { incidentId: string } }>(
    "/incidents/:incidentId/resolve",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const ok = await asUser(sqlRw, uid(req), async (db: Db) => {
        const rows = await db`
          update incidents set resolved_at = now()
          where id = ${req.params.incidentId} and resolved_at is null
          returning id`;
        return rows.length > 0;
      });
      if (!ok) return reply.code(404).send({ code: "not_found" });
      return reply.code(204).send();
    },
  );
}
