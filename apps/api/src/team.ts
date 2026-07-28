import type { FastifyInstance } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";
import { env } from "./env.ts";
import {
  hashInviteToken,
  newInviteToken,
  INVITE_TTL_DAYS,
} from "./credentials.ts";

/**
 * Gates and the people on them.
 *
 * This is what turns the scanner from a demo into something a couple can
 * use: until an organiser can create an entrance and put an usher on it,
 * every check-in has to be seeded by hand.
 *
 * Two rules from the handoff shape it:
 *
 *   "Phone is the primary identifier. Email optional everywhere."
 *      An usher is invited by phone. If no account exists, one is created
 *      with no password — they sign in with an OTP like everyone else, and
 *      their assignment is waiting.
 *
 *   "Ushers are assigned per leg, not per event. Someone can work the
 *    Lagos leg without ever seeing the Abuja guest list."
 *      So assignments hang off event_legs, and the roster is per leg.
 *
 * Permissions default closed. can_override (admit despite an RSVP block)
 * and can_walk_in are both off unless the organiser says otherwise —
 * phase-4c calls manual entry the most abusable action in the system.
 */

type Sendable = { code: number; body: unknown };
const FORBIDDEN: Sendable = {
  code: 403,
  body: { code: "forbidden", message: "Not your event." },
};

const PHONE_RE = /^\+\d{8,15}$/;
const ROLES = ["usher", "event_manager", "owner"] as const;
type Role = (typeof ROLES)[number];

function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.replace(/[\s\-().]/g, "");
  return PHONE_RE.test(p) ? p : null;
}

async function managesLeg(db: Db, legId: string): Promise<boolean> {
  const [row] = await db`select app_manages_leg(${legId}::uuid) as ok`;
  return row?.ok === true;
}

/** The roster, with the readiness signal the handoff asks for. */
async function roster(db: Db, legId: string) {
  return db`
    select
      sa.id,
      sa.leg_id,
      sa.entrance_id,
      en.name  as entrance_name,
      sa.can_walk_in,
      sa.can_manual,
      sa.can_override,
      sa.last_tested_at,
      u.id     as user_id,
      u.full_name,
      u.phone,
      coalesce(m.role::text, 'usher') as role,
      -- Readiness check 8: has this person actually opened the scanner?
      (sa.last_tested_at is not null) as has_tested,
      (select count(*)::int from check_in_events c
       where c.staff_user_id = u.id and c.leg_id = sa.leg_id) as scans
    from staff_assignments sa
    join users u on u.id = sa.user_id
    join event_legs l on l.id = sa.leg_id
    left join workspace_memberships m
      on m.user_id = u.id
      and m.workspace_id = (select workspace_id from events where id = l.event_id)
    left join entrances en on en.id = sa.entrance_id
    where sa.leg_id = ${legId}
    order by u.full_name nulls last, u.phone`;
}

export async function teamRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  // ---- gates --------------------------------------------------------------

  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/entrances",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        if (!(await managesLeg(db, req.params.legId))) return FORBIDDEN;
        const rows = await db`
          select en.id, en.leg_id, en.name, en.is_active,
                 coalesce(sum(c.admitted_count) filter (
                   where c.result in ('admitted','partial','manual',
                                      'overflow_admitted','re_entry')), 0)::int as admitted,
                 (select count(*)::int from staff_assignments sa
                  where sa.entrance_id = en.id) as ushers
          from entrances en
          left join check_in_events c on c.entrance_id = en.id
          where en.leg_id = ${req.params.legId}
          group by en.id, en.leg_id, en.name, en.is_active
          order by en.name`;
        return { code: 200, body: rows };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.post<{ Params: { legId: string }; Body: { name?: string } }>(
    "/legs/:legId/entrances",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const name = req.body?.name?.trim();
      if (!name) {
        return reply.code(400).send({
          code: "bad_name",
          message: "A gate needs a name — 'Main Gate' is fine.",
        });
      }

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { legId } = req.params;
        if (!(await managesLeg(db, legId))) return FORBIDDEN;

        const rows = await db`
          insert into entrances (leg_id, name) values (${legId}, ${name})
          on conflict (leg_id, name) do nothing
          returning id, leg_id, name, is_active`;
        if (rows.length === 0) {
          return {
            code: 409,
            body: {
              code: "gate_exists",
              message: `There's already a gate called ${name} here.`,
            },
          };
        }
        return { code: 201, body: rows[0] };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.patch<{
    Params: { entranceId: string };
    Body: { name?: string; is_active?: boolean };
  }>(
    "/entrances/:entranceId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const name = b.name?.trim();
      if (!name && b.is_active === undefined) {
        return reply.code(400).send({ code: "bad_request", message: "Nothing to change." });
      }

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [en] = await db`
          select leg_id from entrances where id = ${req.params.entranceId}`;
        if (!en || !(await managesLeg(db, en.leg_id))) return FORBIDDEN;

        const rows = await db`
          update entrances set
            name = coalesce(${name ?? null}, name),
            is_active = coalesce(${b.is_active ?? null}, is_active)
          where id = ${req.params.entranceId}
          returning id, leg_id, name, is_active`;
        return { code: 200, body: rows[0] };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.delete<{ Params: { entranceId: string } }>(
    "/entrances/:entranceId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [en] = await db`
          select leg_id from entrances where id = ${req.params.entranceId}`;
        if (!en || !(await managesLeg(db, en.leg_id))) return FORBIDDEN;

        // A gate people actually walked through is part of the record.
        //
        // check_in_events.entrance_id is ON DELETE SET NULL, and that SET
        // NULL is an UPDATE — which the append-only trigger refuses, as it
        // should. Rather than open another door in that guarantee, the
        // product answer is the honest one: a used gate gets closed, not
        // erased. Closing already hides it from the scanner.
        const [used] = await db`
          select count(*)::int as n from check_in_events
          where entrance_id = ${req.params.entranceId}`;
        if (used!.n > 0) {
          return {
            code: 409,
            body: {
              code: "gate_has_history",
              message: `${used!.n} ${used!.n === 1 ? "scan went" : "scans went"} through this gate, so it stays on the record. Close it instead — it disappears from the scanner either way.`,
            },
          };
        }

        await db`delete from entrances where id = ${req.params.entranceId}`;
        return { code: 204, body: null };
      });
      return out.code === 204
        ? reply.code(204).send()
        : reply.code(out.code).send(out.body);
    },
  );

  // ---- the people ---------------------------------------------------------

  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/staff",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        if (!(await managesLeg(db, req.params.legId))) return FORBIDDEN;
        return { code: 200, body: await roster(db, req.params.legId) };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.post<{
    Params: { legId: string };
    Body: {
      phone?: string;
      full_name?: string;
      role?: string;
      entrance_id?: string | null;
      can_walk_in?: boolean;
      can_manual?: boolean;
      can_override?: boolean;
    };
  }>(
    "/legs/:legId/staff",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const phone = normalisePhone(b.phone);
      if (!phone) {
        return reply.code(400).send({
          code: "bad_phone",
          message: "A phone number like +2348034112098 — it's how they sign in.",
        });
      }
      const role: Role = ROLES.includes(b.role as Role) ? (b.role as Role) : "usher";
      if (role === "owner") {
        return reply.code(400).send({
          code: "cannot_grant_owner",
          message: "An event has one owner, and it isn't something you hand out here.",
        });
      }
      const fullName = b.full_name?.trim();

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { legId } = req.params;
        if (!(await managesLeg(db, legId))) return FORBIDDEN;

        if (b.entrance_id) {
          const [en] = await db`
            select id from entrances
            where id = ${b.entrance_id} and leg_id = ${legId}`;
          if (!en) {
            return {
              code: 400,
              body: {
                code: "wrong_leg_gate",
                message: "That gate belongs to a different part of the event.",
              },
            };
          }
        }

        // Find or create. An usher who has never heard of us gets a
        // password-less account; the OTP they request later is the whole
        // sign-up. full_name is filled in if we were told one and they
        // don't already have theirs.
        const [user] = await db`
          insert into users (phone, full_name)
          values (${phone}, ${fullName ?? ""})
          on conflict (phone) do update
            set full_name = case
              when users.full_name = '' then coalesce(${fullName ?? null}, users.full_name)
              else users.full_name
            end
          returning id, full_name, phone`;

        const [legRow] = await db`
          select event_id from event_legs where id = ${legId}`;
        const [event] = await db`
          select workspace_id from events where id = ${legRow!.event_id}`;

        // A membership so the team list and /me agree about who this is.
        // 'usher' grants nothing on its own — app_manages_workspace only
        // recognises owner and event_manager.
        await db`
          insert into workspace_memberships (workspace_id, user_id, role)
          values (${event!.workspace_id}, ${user!.id}, ${role}::workspace_role)
          on conflict (workspace_id, user_id) do update set role = excluded.role`;

        // Permissions default closed: manual entry is the most abusable
        // action in the system, so nothing is granted by omission.
        const [assignment] = await db`
          insert into staff_assignments
            (user_id, leg_id, entrance_id, can_walk_in, can_manual, can_override)
          values (${user!.id}, ${legId}, ${b.entrance_id ?? null},
            ${b.can_walk_in ?? false}, ${b.can_manual ?? true},
            ${b.can_override ?? false})
          on conflict (user_id, leg_id) do update set
            entrance_id  = excluded.entrance_id,
            can_walk_in  = excluded.can_walk_in,
            can_manual   = excluded.can_manual,
            can_override = excluded.can_override
          returning id`;

        return {
          code: 201,
          body: {
            id: assignment!.id,
            user: user,
            role,
            leg_id: legId,
            entrance_id: b.entrance_id ?? null,
            can_walk_in: b.can_walk_in ?? false,
            can_manual: b.can_manual ?? true,
            can_override: b.can_override ?? false,
          },
        };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.patch<{
    Params: { assignmentId: string };
    Body: {
      entrance_id?: string | null;
      can_walk_in?: boolean;
      can_manual?: boolean;
      can_override?: boolean;
    };
  }>(
    "/staff/:assignmentId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [sa] = await db`
          select leg_id from staff_assignments where id = ${req.params.assignmentId}`;
        if (!sa || !(await managesLeg(db, sa.leg_id))) return FORBIDDEN;

        if (b.entrance_id) {
          const [en] = await db`
            select id from entrances
            where id = ${b.entrance_id} and leg_id = ${sa.leg_id}`;
          if (!en) {
            return {
              code: 400,
              body: {
                code: "wrong_leg_gate",
                message: "That gate belongs to a different part of the event.",
              },
            };
          }
        }

        const rows = await db`
          update staff_assignments set
            entrance_id  = ${Object.hasOwn(b, "entrance_id") ? (b.entrance_id ?? null) : db`entrance_id`},
            can_walk_in  = coalesce(${b.can_walk_in ?? null}, can_walk_in),
            can_manual   = coalesce(${b.can_manual ?? null}, can_manual),
            can_override = coalesce(${b.can_override ?? null}, can_override)
          where id = ${req.params.assignmentId}
          returning id, leg_id, entrance_id, can_walk_in, can_manual, can_override`;
        return { code: 200, body: rows[0] };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.delete<{ Params: { assignmentId: string } }>(
    "/staff/:assignmentId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [sa] = await db`
          select leg_id from staff_assignments where id = ${req.params.assignmentId}`;
        if (!sa || !(await managesLeg(db, sa.leg_id))) return FORBIDDEN;

        // Their scans stay attributed to them — check_in_events.staff_user_id
        // has no cascade, and the morning-after report needs to say who was
        // on the gate. Removing someone takes away access, not history.
        await db`delete from staff_assignments where id = ${req.params.assignmentId}`;
        return { code: 204, body: null };
      });
      return out.code === 204
        ? reply.code(204).send()
        : reply.code(out.code).send(out.body);
    },
  );

  /**
   * POST /staff/:staffId/invite — a one-time sign-in link for this usher.
   *
   * The alternative to an SMS. The organiser shares it over WhatsApp, which
   * is already how this product delivers everything and costs nothing, and
   * the usher taps it. No password to forget, no reset flow, and nothing
   * for casual staff to manage.
   *
   * Same trust model as a guest pass: the link IS the credential. It is
   * single-use, expires, and issuing a new one kills any outstanding link
   * for that assignment — which is also how an organiser revokes one sent
   * to the wrong number.
   */
  app.post<{ Params: { staffId: string } }>(
    "/staff/:staffId/invite",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [staff] = await db`
          select id, user_id, leg_id from staff_assignments
          where id = ${req.params.staffId}`;
        if (!staff || !(await managesLeg(db, staff.leg_id))) return FORBIDDEN;

        const token = newInviteToken();
        const expiresAt = new Date(
          Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000,
        );

        // asUser already runs inside a transaction, so these two land
        // together. One live link per assignment: re-issuing is how you
        // take back a link that went to the wrong number.
        await db`
          update staff_invites set expires_at = now()
          where user_id = ${staff.user_id} and leg_id = ${staff.leg_id}
            and accepted_at is null and expires_at > now()`;
        await db`
          insert into staff_invites
            (user_id, leg_id, token_hash, created_by, expires_at)
          values (
            ${staff.user_id}, ${staff.leg_id}, ${hashInviteToken(token)},
            ${uid(req)}, ${expiresAt}
          )`;

        return {
          code: 201,
          body: {
            // Shown once. We store only the hash, so it cannot be re-read.
            url: `${env.webUrl}/join/${token}`,
            expires_at: expiresAt.toISOString(),
          },
        };
      });
      return reply.code(out.code).send(out.body);
    },
  );
}
