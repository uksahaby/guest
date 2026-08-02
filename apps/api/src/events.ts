import type { FastifyInstance, FastifyReply } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";
import { env } from "./env.ts";
import { issueToken } from "checkin-core/token";

/**
 * Organiser-facing routes: events, the guest list, WhatsApp delivery links,
 * live attendance.
 *
 * Every handler runs inside asUser(sqlRw, …), so RLS scopes each query to
 * the caller's workspaces (db/migrations/003_rls.sql). The access checks
 * below call app_manages_event() — the very predicate the policies use —
 * so a route and its policy can never disagree. They exist to turn an
 * empty result into an honest 403.
 *
 * Rules enforced here, from HANDOFF §3–4:
 *  · every event gets its leg in the same transaction — no legless events
 *  · workspaces are implicit until needed; a couple never learns the word
 *  · a pass is issued the moment a household is created, not at RSVP
 *  · the paywall sits on SENDING (delivery-links), never on storing
 *  · wa.me deep links, zero messaging cost — the whole wedge
 */

async function manages(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db`select app_manages_event(${eventId}::uuid) as ok`;
  return row?.ok === true;
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ code: "forbidden", message: "Not your event." });
}

async function eventShape(db: Db, eventId: string) {
  const [event] = await db`
    select id, name, event_type, status, cover_image_url, allow_overflow,
           require_rsvp, allow_walkins, rsvp_deadline, plan, people_limit
    from events where id = ${eventId}`;
  const legs = await db`
    select id, name, sequence, starts_at, doors_close_at, venue_name,
           address_line, city, tables_enabled
    from event_legs where event_id = ${eventId} order by sequence`;
  return { ...event, legs };
}

export async function eventRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  // ---- events -------------------------------------------------------------

  app.get("/events", { preHandler: [app.authenticate] }, async (req) =>
    asUser(sqlRw, uid(req), async (db) => {
      // No where clause needed: RLS already limits this to the caller's
      // events. Belt-and-braces filtering would only hide policy bugs.
      const rows = await db`select id from events order by created_at desc`;
      return Promise.all(rows.map((r) => eventShape(db, r.id)));
    }),
  );

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
    const { name, event_type, leg } = req.body ?? {};
    if (!name || !leg?.name || !leg.starts_at) {
      return reply.code(400).send({
        code: "bad_request",
        message: "name and leg { name, starts_at } are required.",
      });
    }
    const legName = leg.name;
    const legStartsAt = leg.starts_at;
    const userId = uid(req);

    const eventId = await asUser(sqlRw, userId, async (db) => {
      // The implicit workspace (decision #6): auto-created on first event,
      // invisible until the user grows into needing the concept.
      let [ws] = await db`
        select id from workspaces where owner_user_id = ${userId}
        order by created_at limit 1`;
      if (!ws) {
        [ws] = await db`
          insert into workspaces (name, owner_user_id, is_implicit)
          select coalesce(nullif(full_name, ''), 'My events'), id, true
          from users where id = ${userId}
          returning id`;
      }

      const [e] = await db`
        insert into events (workspace_id, name, event_type, signing_key)
        values (${ws!.id}, ${name}, ${event_type ?? "wedding"}, gen_random_bytes(32))
        returning id`;
      await db`
        insert into event_legs (event_id, name, sequence, starts_at,
          doors_close_at, venue_name, address_line, city, tables_enabled)
        values (${e!.id}, ${legName}, 1, ${legStartsAt},
          ${leg.doors_close_at ?? null}, ${leg.venue_name ?? null},
          ${leg.address_line ?? null}, ${leg.city ?? null},
          ${leg.tables_enabled ?? false})`;
      return e!.id as string;
    });

    return reply
      .code(201)
      .send(await asUser(sqlRw, userId, (db) => eventShape(db, eventId)));
  });

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        if (!(await manages(db, req.params.eventId))) return forbidden(reply);
        return eventShape(db, req.params.eventId);
      }),
  );

  // ---- the guest list -----------------------------------------------------

  app.get<{
    Params: { eventId: string };
    Querystring: {
      q?: string;
      limit?: string;
      offset?: string;
      /** attending | partial | declined | pending | no_response */
      rsvp?: string;
      category?: string;
      table?: string;
    };
  }>(
    "/events/:eventId/invitations",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return forbidden(reply);

        const q = (req.query.q ?? "").trim();
        const limit = Math.min(Number(req.query.limit ?? 200), 500);
        const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
        const rsvp = (req.query.rsvp ?? "").trim();
        const category = (req.query.category ?? "").trim();
        const table = (req.query.table ?? "").trim();

        /**
         * "Pending" and "No response" are the same rsvp value and are not
         * the same problem. Someone who opened their invitation and did
         * not reply needs a nudge; someone who never opened it may never
         * have received it, which is a different job. delivery_state is
         * what tells them apart.
         */
        const where = db`
          where i.event_id = ${eventId}
            ${q ? db`and (i.display_name ilike ${"%" + q + "%"}
                          or i.primary_phone like ${"%" + q + "%"}
                          or i.primary_email ilike ${"%" + q + "%"})` : db``}
            ${category ? db`and gc.name = ${category}` : db``}
            ${table ? db`and exists (
                 select 1 from invitation_legs il2
                 join seating_tables st2 on st2.id = il2.table_id
                 where il2.invitation_id = i.id and st2.name = ${table})` : db``}
            ${rsvp === "confirmed" ? db`and exists (
                 select 1 from invitation_legs il3 where il3.invitation_id = i.id
                   and il3.rsvp in ('attending','partial'))` : db``}
            ${rsvp === "declined" ? db`and exists (
                 select 1 from invitation_legs il3 where il3.invitation_id = i.id
                   and il3.rsvp = 'declined')` : db``}
            ${rsvp === "pending" ? db`and exists (
                 select 1 from invitation_legs il3 where il3.invitation_id = i.id
                   and il3.rsvp = 'pending')
               and exists (select 1 from invitation_deliveries d2
                 where d2.invitation_id = i.id and d2.opened_at is not null)` : db``}
            ${rsvp === "no_response" ? db`and exists (
                 select 1 from invitation_legs il3 where il3.invitation_id = i.id
                   and il3.rsvp = 'pending')
               and not exists (select 1 from invitation_deliveries d2
                 where d2.invitation_id = i.id and d2.opened_at is not null)` : db``}`;

        const invitations = await db`
          select i.id, i.display_name, i.primary_phone, i.primary_email,
                 gc.name as category,
                 (select count(*)::int from guests g where g.invitation_id = i.id) as named_count,
                 -- Precedence by fact, not by alphabet. max(state::text)
                 -- ranks 'sent' above 'opened' because s > o, so anyone
                 -- who opened their invitation was reported as merely
                 -- sent — and the guest list derives "pending" from this.
                 coalesce((
                   select case
                     when bool_or(d.opened_at is not null) then 'opened'
                     when bool_or(d.sent_at is not null) then 'sent'
                     when bool_or(d.generated_at is not null) then 'link_generated'
                     else 'not_sent' end
                   from invitation_deliveries d
                   where d.invitation_id = i.id
                 ), 'not_sent') as delivery_state
          from invitations i
          left join guest_categories gc on gc.id = i.category_id
          ${where}
          order by i.display_name
          limit ${limit} offset ${offset}`;

        const [totalRow] = await db<{ n: number }[]>`
          select count(*)::int as n
          from invitations i
          left join guest_categories gc on gc.id = i.category_id
          ${where}`;
        const total = totalRow!.n;

        // Counts for the whole event, not the filtered page: they are the
        // filter buttons, so they have to say what clicking one would give.
        const [counts] = await db`
          select
            count(*)::int as households,
            coalesce(sum(il.allowance), 0)::int as people,
            count(*) filter (where il.rsvp in ('attending','partial'))::int
              as confirmed,
            count(*) filter (where il.rsvp = 'declined')::int as declined,
            count(*) filter (where il.rsvp = 'pending' and exists (
              select 1 from invitation_deliveries d
              where d.invitation_id = i.id and d.opened_at is not null))::int
              as pending,
            count(*) filter (where il.rsvp = 'pending' and not exists (
              select 1 from invitation_deliveries d
              where d.invitation_id = i.id and d.opened_at is not null))::int
              as no_response
          from invitations i
          join invitation_legs il on il.invitation_id = i.id
          where i.event_id = ${eventId}`;

        const categories = await db`
          select distinct gc.name from invitations i
          join guest_categories gc on gc.id = i.category_id
          where i.event_id = ${eventId} order by gc.name`;

        const tables = await db`
          select st.name from seating_tables st
          join event_legs l on l.id = st.leg_id
          where l.event_id = ${eventId} order by st.name`;

        const ids = invitations.map((i) => i.id);
        const legRows = ids.length
          ? await db`
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
          total,
          limit,
          offset,
          counts,
          categories: categories.map((c) => c.name),
          tables: tables.map((t) => t.name),
          next_cursor: null,
        };
      }),
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
      const legs = b.legs;
      const guests = b.guests ?? [];

      // Reply only after the transaction commits, or a client can read
      // back its own write and not find it.
      const created = await asUser(sqlRw, uid(req), async (db) => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return null;

        const [inv] = await db`
          insert into invitations (event_id, display_name, primary_phone,
            primary_email, category_id)
          values (${eventId}, ${displayName}, ${b.primary_phone ?? null},
            ${b.primary_email ?? null}, ${b.category_id ?? null})
          returning id`;
        for (const l of legs) {
          await db`
            insert into invitation_legs (invitation_id, leg_id, allowance, table_id)
            values (${inv!.id}, ${l.leg_id}, ${l.allowance}, ${l.table_id ?? null})`;
        }
        for (const [n, g] of guests.entries()) {
          await db`
            insert into guests (invitation_id, first_name, last_name, is_primary)
            values (${inv!.id}, ${g.first_name}, ${g.last_name ?? null}, ${n === 0})`;
        }
        // Decision #1: the pass exists from the moment the household does.
        // RSVP updates it; it never creates it.
        await db`
          insert into passes (invitation_id, event_id)
          values (${inv!.id}, ${eventId})`;

        return { id: inv!.id as string };
      });

      if (!created) return forbidden(reply);
      return reply.code(201).send(created);
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
      const ids = req.body?.invitation_ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({
          code: "bad_request",
          message: "invitation_ids is required.",
        });
      }
      const template =
        req.body?.template ??
        "Hello {name}! You're invited to {event}. Open your invitation and pass here: {link}";
      const userId = uid(req);

      return asUser(sqlRw, userId, async (db) => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return forbidden(reply);

        // signing_key is withheld from app_rw by column grant, so the token
        // is minted through the same narrow path the guest pages use.
        const [event] = await db`
          select name, people_limit, token_version from events where id = ${eventId}`;

        // The billing gate (HANDOFF §3): a pass counts against the limit
        // when its invitation is SENT — building the list is always free.
        const [counts] = await db`
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

        const rows = await db`
          select i.id, i.display_name, i.primary_phone, p.id as pass_id
          from invitations i
          join passes p on p.invitation_id = i.id
          where i.event_id = ${eventId} and i.id = any(${ids})`;

        const key = await signingKeyFor(eventId);
        const links = [];
        for (const r of rows) {
          const token = issueToken(
            { passId: r.pass_id, eventId, tokenVersion: event!.token_version },
            key,
          );
          const inviteUrl = `${env.webUrl}/i/${token}`;
          const message = template
            .replaceAll("{name}", r.display_name)
            .replaceAll("{event}", event!.name)
            .replaceAll("{link}", inviteUrl);
          const phoneDigits = (r.primary_phone ?? "").replace(/\D/g, "");

          // One delivery row per household per channel; regenerating the
          // link (organiser reopens the page) is not a new send.
          await db`
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
      });
    },
  );

  // ---- live attendance ----------------------------------------------------

  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/attendance",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        const { legId } = req.params;
        const [ok] = await db`select app_manages_leg(${legId}::uuid) as ok`;
        if (ok?.ok !== true) return forbidden(reply);

        const [att] = await db`select * from leg_attendance where leg_id = ${legId}`;
        const [refused] = await db`
          select count(*)::int as n from check_in_events
          where leg_id = ${legId} and admitted_count = 0 and result in
            ('allowance_exhausted','invalid','wrong_event','wrong_leg','revoked',
             'rsvp_blocked','rsvp_declined','overflow_blocked','not_found')`;
        const byEntrance = await db`
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
      }),
  );
}

/**
 * Minting a pass token needs the event's signing key, which no application
 * role may read (column grant). The verifier role is the one narrow path
 * to it — see db.ts.
 */
async function signingKeyFor(eventId: string): Promise<Buffer> {
  const { sqlVerify } = await import("./db.ts");
  const [row] = await sqlVerify`
    select signing_key from events where id = ${eventId}`;
  if (!row) throw new Error("event not found");
  return Buffer.from(row.signing_key);
}
