import type { FastifyInstance, FastifyReply } from "fastify";
import { sql } from "./db.ts";
import { env } from "./env.ts";
import { issueToken } from "checkin-core/token";

/**
 * Organiser-facing routes: events, the guest list, WhatsApp delivery links,
 * live attendance.
 *
 * Rules enforced here, from HANDOFF §3–4:
 *  · every event gets its leg in the same transaction — no legless events
 *  · workspaces are implicit until needed; a couple never learns the word
 *  · a pass is issued the moment a household is created, not at RSVP
 *  · the paywall sits on SENDING (delivery-links), never on storing
 *  · wa.me deep links, zero messaging cost — the whole wedge
 */

type Access = { eventId: string; workspaceId: string } | null;

async function eventAccess(userId: string, eventId: string): Promise<Access> {
  const rows = await sql`
    select e.id, e.workspace_id
    from events e
    join workspaces w on w.id = e.workspace_id
    left join workspace_memberships m
      on m.workspace_id = w.id and m.user_id = ${userId}
    where e.id = ${eventId}
      and (w.owner_user_id = ${userId}
           or m.role in ('owner', 'event_manager'))`;
  return rows.length > 0
    ? { eventId: rows[0]!.id, workspaceId: rows[0]!.workspace_id }
    : null;
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ code: "forbidden", message: "Not your event." });
}

const eventShape = async (eventId: string) => {
  const [event] = await sql`
    select id, name, event_type, status, cover_image_url, allow_overflow,
           require_rsvp, allow_walkins, rsvp_deadline, plan, people_limit
    from events where id = ${eventId}`;
  const legs = await sql`
    select id, name, sequence, starts_at, doors_close_at, venue_name,
           address_line, city, tables_enabled
    from event_legs where event_id = ${eventId} order by sequence`;
  return { ...event, legs };
};

export async function eventRoutes(app: FastifyInstance) {
  // ---- events -------------------------------------------------------------

  app.get("/events", { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const rows = await sql`
      select distinct e.id
      from events e
      join workspaces w on w.id = e.workspace_id
      left join workspace_memberships m
        on m.workspace_id = w.id and m.user_id = ${userId}
      where w.owner_user_id = ${userId}
         or m.role in ('owner', 'event_manager')
      order by e.id`;
    return Promise.all(rows.map((r) => eventShape(r.id)));
  });

  app.post<{
    Body: {
      name?: string;
      event_type?: string;
      leg?: {
        name?: string;
        starts_at?: string;
        doors_close_at?: string;
        venue_name?: string;
        address_line?: string;
        city?: string;
        tables_enabled?: boolean;
      };
    };
  }>("/events", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const { name, event_type, leg } = req.body ?? {};
    if (!name || !leg?.name || !leg.starts_at) {
      return reply.code(400).send({
        code: "bad_request",
        message: "name and leg { name, starts_at } are required.",
      });
    }
    // Narrowed locals — the transaction closure below can't see the guard.
    const legName = leg.name;
    const legStartsAt = leg.starts_at;

    // The implicit workspace (decision #6): auto-created on first event,
    // invisible until the user grows into needing the concept.
    let [ws] = await sql`
      select id from workspaces where owner_user_id = ${userId}
      order by created_at limit 1`;
    if (!ws) {
      [ws] = await sql`
        insert into workspaces (name, owner_user_id, is_implicit)
        select coalesce(nullif(full_name, ''), 'My events'), id, true
        from users where id = ${userId}
        returning id`;
    }

    const eventId = await sql.begin(async (tx) => {
      const [e] = await tx`
        insert into events (workspace_id, name, event_type, signing_key)
        values (${ws!.id}, ${name}, ${event_type ?? "wedding"}, gen_random_bytes(32))
        returning id`;
      await tx`
        insert into event_legs (event_id, name, sequence, starts_at,
          doors_close_at, venue_name, address_line, city, tables_enabled)
        values (${e!.id}, ${legName}, 1, ${legStartsAt},
          ${leg.doors_close_at ?? null}, ${leg.venue_name ?? null},
          ${leg.address_line ?? null}, ${leg.city ?? null},
          ${leg.tables_enabled ?? false})`;
      return e!.id as string;
    });

    return reply.code(201).send(await eventShape(eventId));
  });

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      if (!(await eventAccess(userId, req.params.eventId))) return forbidden(reply);
      return eventShape(req.params.eventId);
    },
  );

  // ---- the guest list -----------------------------------------------------

  app.get<{ Params: { eventId: string }; Querystring: { q?: string; limit?: string } }>(
    "/events/:eventId/invitations",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const { eventId } = req.params;
      if (!(await eventAccess(userId, eventId))) return forbidden(reply);

      const q = (req.query.q ?? "").trim();
      const limit = Math.min(Number(req.query.limit ?? 200), 500);

      const invitations = await sql`
        select i.id, i.display_name, i.primary_phone, i.primary_email,
               gc.name as category,
               (select count(*)::int from guests g where g.invitation_id = i.id) as named_count,
               coalesce((
                 select max(d.state::text) from invitation_deliveries d
                 where d.invitation_id = i.id
               ), 'not_sent') as delivery_state
        from invitations i
        left join guest_categories gc on gc.id = i.category_id
        where i.event_id = ${eventId}
          ${q ? sql`and (i.display_name ilike ${"%" + q + "%"} or i.primary_phone like ${"%" + q + "%"})` : sql``}
        order by i.display_name
        limit ${limit}`;

      const ids = invitations.map((i) => i.id);
      const legRows = ids.length
        ? await sql`
            select il.invitation_id, il.leg_id, il.allowance, il.rsvp,
                   il.rsvp_count, st.name as table_name,
                   coalesce((
                     select sum(c.admitted_count)::int from check_in_events c
                     join passes p on p.id = c.pass_id
                     where p.invitation_id = il.invitation_id
                       and c.leg_id = il.leg_id
                       and c.result in ('admitted','partial','manual',
                                        'overflow_admitted','re_entry','reversal')
                   ), 0) as admitted
            from invitation_legs il
            left join seating_tables st on st.id = il.table_id
            where il.invitation_id = any(${ids})`
        : [];

      const byInv = new Map<string, unknown[]>();
      for (const l of legRows) {
        const list = byInv.get(l.invitation_id) ?? [];
        list.push({
          leg_id: l.leg_id,
          allowance: l.allowance,
          rsvp: l.rsvp,
          rsvp_count: l.rsvp_count,
          table_name: l.table_name,
          admitted: l.admitted,
          remaining: Math.max(0, l.allowance - l.admitted),
        });
        byInv.set(l.invitation_id, list);
      }

      return {
        data: invitations.map((i) => ({ ...i, legs: byInv.get(i.id) ?? [] })),
        next_cursor: null,
      };
    },
  );

  app.post<{
    Params: { eventId: string };
    Body: {
      display_name?: string;
      primary_phone?: string;
      primary_email?: string;
      category_id?: string | null;
      legs?: { leg_id: string; allowance: number; table_id?: string | null }[];
      guests?: { first_name: string; last_name?: string }[];
    };
  }>(
    "/events/:eventId/invitations",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const { eventId } = req.params;
      if (!(await eventAccess(userId, eventId))) return forbidden(reply);

      const b = req.body ?? {};
      if (!b.display_name || !Array.isArray(b.legs) || b.legs.length === 0) {
        return reply.code(400).send({
          code: "bad_request",
          message: "display_name and at least one leg entitlement are required.",
        });
      }
      for (const l of b.legs) {
        if (!Number.isInteger(l.allowance) || l.allowance < 1) {
          return reply.code(400).send({
            code: "bad_request",
            message: "Every allowance must be a whole number of at least 1.",
          });
        }
      }
      const displayName = b.display_name;

      const invitationId = await sql.begin(async (tx) => {
        const [inv] = await tx`
          insert into invitations (event_id, display_name, primary_phone,
            primary_email, category_id)
          values (${eventId}, ${displayName}, ${b.primary_phone ?? null},
            ${b.primary_email ?? null}, ${b.category_id ?? null})
          returning id`;
        for (const l of b.legs!) {
          await tx`
            insert into invitation_legs (invitation_id, leg_id, allowance, table_id)
            values (${inv!.id}, ${l.leg_id}, ${l.allowance}, ${l.table_id ?? null})`;
        }
        for (const [n, g] of (b.guests ?? []).entries()) {
          await tx`
            insert into guests (invitation_id, first_name, last_name, is_primary)
            values (${inv!.id}, ${g.first_name}, ${g.last_name ?? null}, ${n === 0})`;
        }
        // Decision #1: the pass exists from the moment the household does.
        // RSVP updates it; it never creates it.
        await tx`
          insert into passes (invitation_id, event_id)
          values (${inv!.id}, ${eventId})`;
        return inv!.id as string;
      });

      return reply.code(201).send({ id: invitationId });
    },
  );

  // ---- WhatsApp delivery links -------------------------------------------

  app.post<{
    Params: { eventId: string };
    Body: { invitation_ids?: string[]; template?: string | null };
  }>(
    "/events/:eventId/delivery-links",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const { eventId } = req.params;
      if (!(await eventAccess(userId, eventId))) return forbidden(reply);

      const ids = req.body?.invitation_ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({
          code: "bad_request",
          message: "invitation_ids is required.",
        });
      }

      const [event] = await sql`
        select name, people_limit, signing_key, token_version
        from events where id = ${eventId}`;

      // The billing gate (HANDOFF §3): a pass counts against the limit when
      // its invitation is SENT — building the list is always free.
      const [counts] = await sql`
        select
          coalesce(sum(mx) filter (where sent), 0)::int as consumed,
          coalesce(sum(mx) filter (where not sent and id = any(${ids})), 0)::int as adding
        from (
          select i.id,
                 max(il.allowance) as mx,
                 exists (select 1 from invitation_deliveries d
                         where d.invitation_id = i.id) as sent
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          where i.event_id = ${eventId}
          group by i.id
        ) s`;
      if (counts!.consumed + counts!.adding > event!.people_limit) {
        return reply.code(402).send({
          code: "limit_reached",
          message: `This would take the event to ${counts!.consumed + counts!.adding} people on a ${event!.people_limit}-person plan.`,
        });
      }

      const rows = await sql`
        select i.id, i.display_name, i.primary_phone, p.id as pass_id
        from invitations i
        join passes p on p.invitation_id = i.id
        where i.event_id = ${eventId} and i.id = any(${ids})`;

      const template =
        req.body?.template ??
        "Hello {name}! You're invited to {event}. Open your invitation and pass here: {link}";

      const links = [];
      for (const r of rows) {
        const token = issueToken(
          { passId: r.pass_id, eventId, tokenVersion: event!.token_version },
          Buffer.from(event!.signing_key),
        );
        const inviteUrl = `${env.webUrl}/i/${token}`;
        const message = template
          .replaceAll("{name}", r.display_name)
          .replaceAll("{event}", event!.name)
          .replaceAll("{link}", inviteUrl);
        const phoneDigits = (r.primary_phone ?? "").replace(/\D/g, "");

        // One delivery row per household per channel; regenerating the link
        // (organiser reopens the page) is not a new send.
        await sql`
          insert into invitation_deliveries
            (invitation_id, channel, state, by_user_id, generated_at)
          select ${r.id}, 'whatsapp_link', 'link_generated', ${userId}, now()
          where not exists (
            select 1 from invitation_deliveries
            where invitation_id = ${r.id} and channel = 'whatsapp_link')`;

        links.push({
          invitation_id: r.id,
          display_name: r.display_name,
          whatsapp_url: phoneDigits
            ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`
            : null,
          invite_url: inviteUrl,
          message,
        });
      }
      return links;
    },
  );

  // ---- live attendance ----------------------------------------------------

  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/attendance",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const { legId } = req.params;
      const [leg] = await sql`select event_id from event_legs where id = ${legId}`;
      if (!leg || !(await eventAccess(userId, leg.event_id))) return forbidden(reply);

      const [att] = await sql`select * from leg_attendance where leg_id = ${legId}`;
      const [refused] = await sql`
        select count(*)::int as n from check_in_events
        where leg_id = ${legId} and admitted_count = 0 and result in
          ('allowance_exhausted','invalid','wrong_event','wrong_leg','revoked',
           'rsvp_blocked','rsvp_declined','overflow_blocked','not_found')`;
      const byEntrance = await sql`
        select en.id as entrance_id, en.name,
               coalesce(sum(c.admitted_count) filter (where c.admitted_count > 0), 0)::int as admitted,
               count(*) filter (where c.admitted_count = 0 and c.result != 'reversal')::int as refused,
               max(c.recorded_at) as last_seen_at
        from entrances en
        left join check_in_events c on c.entrance_id = en.id
        where en.leg_id = ${legId}
        group by en.id, en.name
        order by en.name`;

      return {
        leg_id: legId,
        invitations: Number(att?.invitations ?? 0),
        invited_people: Number(att?.invited_people ?? 0),
        confirmed_people: Number(att?.confirmed_people ?? 0),
        arrived_people: Number(att?.arrived_people ?? 0),
        overflow_parties: Number(att?.overflow_parties ?? 0),
        refused: refused!.n,
        by_entrance: byEntrance,
      };
    },
  );
}
