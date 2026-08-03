import type { FastifyInstance } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * Event settings: the basics, the gate policy, replies, and the three
 * things under "Careful".
 *
 * The settings mockup doesn't just list toggles — each one says what it
 * would cost right now ("Off. 81 people never replied and would be
 * stopped at the gate if you turn this on"). So GET returns those figures
 * alongside the flags; a switch with a number next to it is a decision,
 * a switch on its own is a guess.
 */

type Sendable = { code: number; body: unknown };
const FORBIDDEN: Sendable = {
  code: 403,
  body: { code: "forbidden", message: "Not your event." },
};

const ADMITTING = ["admitted", "partial", "manual", "overflow_admitted", "re_entry"];

/**
 * What an event can be. Returned by GET rather than hard-coded in the web
 * app, so the settings dropdown and the validation here can never drift
 * apart into a select whose options the API rejects.
 */
export const EVENT_TYPES = [
  "wedding",
  "engagement",
  "birthday",
  "naming",
  "funeral",
  "conference",
  "concert",
  "other",
] as const;

/** The description under the event name. 250 is what the mockup counts to. */
const DESCRIPTION_MAX = 250;
const TAG_MAX = 24;
const TAGS_MAX = 12;

/**
 * A custom link is typed by a person and read aloud over the phone, so it
 * is lowercase, hyphenated, and has to survive being written on a napkin.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;

/**
 * Reserved because the guest and app surfaces already own these paths — a
 * slug of "login" would be a link that never reaches an event.
 */
const SLUG_RESERVED = new Set([
  "i", "join", "scan", "login", "logout", "signup", "recover", "welcome",
  "events", "dashboard", "api", "public", "admin", "settings", "profile",
]);

/** Does the runtime know this zone? Cheaper and truer than a list. */
function knownTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function manages(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db`select app_manages_event(${eventId}::uuid) as ok`;
  return row?.ok === true;
}

/** What each toggle would actually do, given this event as it stands. */
async function consequences(db: Db, eventId: string) {
  const [passes] = await db`
    select count(*)::int as n from passes
    where event_id = ${eventId} and status = 'active'`;

  // Households that never replied — the people require_rsvp would stop.
  const [silent] = await db`
    select
      count(*)::int                        as households,
      coalesce(sum(il.allowance), 0)::int  as people
    from invitation_legs il
    join event_legs l on l.id = il.leg_id
    where l.event_id = ${eventId} and il.rsvp = 'pending'`;

  // Parties already admitted over their allowance.
  const [over] = await db`
    select count(*)::int as parties, coalesce(sum(extra), 0)::int as people
    from (
      select il.invitation_id,
             coalesce(sum(c.admitted_count), 0) - il.allowance as extra
      from invitation_legs il
      join event_legs l on l.id = il.leg_id
      join passes p on p.invitation_id = il.invitation_id
      left join check_in_events c
        on c.pass_id = p.id and c.leg_id = il.leg_id
        and c.result in ${db(ADMITTING)}
      where l.event_id = ${eventId}
      group by il.invitation_id, il.allowance
      having coalesce(sum(c.admitted_count), 0) > il.allowance
    ) s`;

  const [walkIns] = await db`
    select count(*)::int as n from invitations
    where event_id = ${eventId} and is_walk_in = true`;

  const [scans] = await db`
    select count(*)::int as n from check_in_events where event_id = ${eventId}`;

  const [sent] = await db`
    select count(*)::int as n
    from invitations i
    join invitation_deliveries d on d.invitation_id = i.id
    where i.event_id = ${eventId}`;

  return {
    active_passes: passes!.n,
    never_replied_households: silent!.households,
    never_replied_people: silent!.people,
    overflow_parties: over!.parties,
    overflow_people: over!.people,
    walk_ins: walkIns!.n,
    scans_recorded: scans!.n,
    invitations_sent: sent!.n,
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/settings",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return FORBIDDEN;

        const [event] = await db`
          select id, name, event_type, description, status, allow_overflow,
                 require_rsvp, allow_walkins, allow_usher_undo, rsvp_deadline,
                 manager_phone, plan, people_limit, token_version,
                 end_date, timezone, tags, slug, public_page, invitation_only
          from events where id = ${eventId}`;
        const legs = await db`
          select id, name, sequence, starts_at, doors_close_at, venue_name,
                 address_line, city, tables_enabled, all_day
          from event_legs where event_id = ${eventId} order by sequence`;

        return {
          code: 200,
          body: {
            ...event,
            legs,
            event_types: EVENT_TYPES,
            consequences: await consequences(db, eventId),
          },
        };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  app.patch<{
    Params: { eventId: string };
    Body: {
      name?: string;
      status?: string;
      allow_overflow?: boolean;
      require_rsvp?: boolean;
      allow_walkins?: boolean;
      allow_usher_undo?: boolean;
      rsvp_deadline?: string | null;
      manager_phone?: string | null;
      // Added with the settings screen (db/migrations/017).
      event_type?: string;
      description?: string | null;
      end_date?: string | null;
      timezone?: string;
      tags?: string[];
      slug?: string | null;
      public_page?: boolean;
      invitation_only?: boolean;
    };
  }>(
    "/events/:eventId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      const STATUSES = ["draft", "active", "completed", "cancelled"];
      if (b.status !== undefined && !STATUSES.includes(b.status)) {
        return reply.code(400).send({
          code: "bad_status",
          message: `Status must be one of ${STATUSES.join(", ")}.`,
        });
      }
      if (b.name !== undefined && !b.name.trim()) {
        return reply.code(400).send({
          code: "bad_name",
          message: "An event needs a name.",
        });
      }
      // Empty clears it; anything else has to be dialable, because the
      // scanner turns it into a tel: link an usher taps one-handed.
      const managerPhone =
        typeof b.manager_phone === "string" ? b.manager_phone.replace(/[\s\-().]/g, "") : b.manager_phone;
      if (managerPhone && !/^\+\d{8,15}$/.test(managerPhone)) {
        return reply.code(400).send({
          code: "bad_manager_phone",
          message: "A number like +2348034112098, so an usher can dial it.",
        });
      }

      if (b.event_type !== undefined && !EVENT_TYPES.includes(b.event_type as never)) {
        return reply.code(400).send({
          code: "bad_event_type",
          message: `Event type must be one of ${EVENT_TYPES.join(", ")}.`,
        });
      }
      if (typeof b.description === "string" && b.description.length > DESCRIPTION_MAX) {
        return reply.code(400).send({
          code: "bad_description",
          message: `Keep the description to ${DESCRIPTION_MAX} characters — it sits under the event name on the invitation.`,
        });
      }
      if (b.end_date) {
        if (Number.isNaN(Date.parse(b.end_date))) {
          return reply.code(400).send({
            code: "bad_end_date",
            message: "That end date didn't make sense.",
          });
        }
      }
      if (b.timezone !== undefined && !knownTimezone(b.timezone)) {
        return reply.code(400).send({
          code: "bad_timezone",
          message: "That isn't a time zone this server knows, e.g. Africa/Lagos.",
        });
      }
      if (b.tags !== undefined) {
        const bad =
          !Array.isArray(b.tags) ||
          b.tags.length > TAGS_MAX ||
          b.tags.some((t) => typeof t !== "string" || !t.trim() || t.length > TAG_MAX);
        if (bad) {
          return reply.code(400).send({
            code: "bad_tags",
            message: `Up to ${TAGS_MAX} tags, each under ${TAG_MAX} characters.`,
          });
        }
      }
      // Empty string clears the custom link; anything else has to be a
      // link a person can say out loud.
      const slug =
        typeof b.slug === "string" ? b.slug.trim().toLowerCase() : b.slug;
      if (slug) {
        if (!SLUG_RE.test(slug) || SLUG_RESERVED.has(slug)) {
          return reply.code(400).send({
            code: "bad_slug",
            message:
              "Lowercase letters, numbers and hyphens, 2–60 characters, and not a word the site already uses.",
          });
        }
      }

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return FORBIDDEN;

        // Someone else's link. Checked here rather than left to the unique
        // index so the organiser gets a sentence instead of a 500 — and
        // checked inside the transaction so it means something.
        if (slug) {
          const [taken] = await db`
            select 1 from events where slug = ${slug} and id <> ${eventId}`;
          if (taken) {
            return {
              code: 409,
              body: {
                code: "slug_taken",
                message: "That link is already in use. Try adding the year.",
              },
            };
          }
        }

        // coalesce keeps every omitted field untouched — a settings form
        // that posts three fields must not blank the other five.
        const [event] = await db`
          update events set
            name             = coalesce(${b.name?.trim() ?? null}, name),
            status           = coalesce(${b.status ?? null}::event_status, status),
            event_type       = coalesce(${b.event_type ?? null}, event_type),
            timezone         = coalesce(${b.timezone ?? null}, timezone),
            tags             = coalesce(${b.tags ? b.tags.map((t) => t.trim()) : null}, tags),
            public_page      = coalesce(${b.public_page ?? null}, public_page),
            invitation_only  = coalesce(${b.invitation_only ?? null}, invitation_only),
            allow_overflow   = coalesce(${b.allow_overflow ?? null}, allow_overflow),
            require_rsvp     = coalesce(${b.require_rsvp ?? null}, require_rsvp),
            allow_walkins    = coalesce(${b.allow_walkins ?? null}, allow_walkins),
            allow_usher_undo = coalesce(${b.allow_usher_undo ?? null}, allow_usher_undo),
            -- These four are nullable and clearable, so an omitted field
            -- and an explicit null have to mean different things.
            description      = ${
              Object.hasOwn(b, "description")
                ? ((b.description ?? "").trim() || null)
                : db`description`
            },
            end_date         = ${
              Object.hasOwn(b, "end_date") ? (b.end_date || null) : db`end_date`
            },
            slug             = ${
              Object.hasOwn(b, "slug") ? (slug || null) : db`slug`
            },
            rsvp_deadline    = ${
              Object.hasOwn(b, "rsvp_deadline")
                ? (b.rsvp_deadline || null)
                : db`rsvp_deadline`
            },
            manager_phone    = ${
              Object.hasOwn(b, "manager_phone")
                ? (managerPhone || null)
                : db`manager_phone`
            },
            updated_at = now()
          where id = ${eventId}
          returning id, name, status, event_type, description, allow_overflow,
                    require_rsvp, allow_walkins, allow_usher_undo, rsvp_deadline,
                    manager_phone, end_date, timezone, tags, slug, public_page,
                    invitation_only`;
        return { code: 200, body: event };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  /**
   * The basics: date and venue. "Changing the date or venue updates every
   * guest's invitation page straight away" — which it does, because the
   * guest page reads this table on every request.
   */
  app.patch<{
    Params: { legId: string };
    Body: {
      name?: string;
      starts_at?: string;
      doors_close_at?: string | null;
      venue_name?: string | null;
      address_line?: string | null;
      city?: string | null;
      all_day?: boolean;
    };
  }>(
    "/legs/:legId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const b = req.body ?? {};
      if (b.starts_at !== undefined && Number.isNaN(Date.parse(b.starts_at))) {
        return reply.code(400).send({
          code: "bad_date",
          message: "That date didn't make sense.",
        });
      }

      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const [ok] = await db`select app_manages_leg(${req.params.legId}::uuid) as ok`;
        if (ok?.ok !== true) return FORBIDDEN;

        const [leg] = await db`
          update event_legs set
            name           = coalesce(${b.name?.trim() ?? null}, name),
            starts_at      = coalesce(${b.starts_at ?? null}, starts_at),
            doors_close_at = ${Object.hasOwn(b, "doors_close_at") ? (b.doors_close_at || null) : db`doors_close_at`},
            venue_name     = ${Object.hasOwn(b, "venue_name") ? (b.venue_name || null) : db`venue_name`},
            address_line   = ${Object.hasOwn(b, "address_line") ? (b.address_line || null) : db`address_line`},
            city           = ${Object.hasOwn(b, "city") ? (b.city || null) : db`city`},
            all_day        = coalesce(${b.all_day ?? null}, all_day)
          where id = ${req.params.legId}
          returning id, name, starts_at, doors_close_at, venue_name,
                    address_line, city, all_day`;
        return { code: 200, body: leg };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  // ---- Careful ------------------------------------------------------------

  /**
   * "Reissue every pass — kills all existing passes and creates new ones."
   * One integer does it: every token carries the version it was signed
   * under, and the scanner refuses any that doesn't match (token.ts).
   * No revocation list, no per-pass work.
   */
  app.post<{ Params: { eventId: string } }>(
    "/events/:eventId/reissue-passes",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return FORBIDDEN;

        const [event] = await db`
          update events
          set token_version = token_version + 1, updated_at = now()
          where id = ${eventId}
          returning token_version`;
        const reissued = await db`
          update passes set token_version = ${event!.token_version}
          where event_id = ${eventId}
          returning id`;

        return {
          code: 200,
          body: {
            token_version: event!.token_version,
            // Every household needs their link again — the old ones are
            // now dead, and saying so is the whole point of the warning.
            passes_reissued: reissued.length,
          },
        };
      });
      return reply.code(out.code).send(out.body);
    },
  );

  /**
   * Deleting an event erases its check-in history, which the append-only
   * trigger otherwise forbids. The transaction names the event it is
   * erasing (db/migrations/006), so this is the one path that can, and a
   * single scan still cannot be quietly removed.
   */
  app.delete<{ Params: { eventId: string } }>(
    "/events/:eventId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { eventId } = req.params;
        if (!(await manages(db, eventId))) return FORBIDDEN;

        await db`select set_config('app.erasing_event', ${eventId}, true)`;
        await db`delete from events where id = ${eventId}`;
        return { code: 204, body: null };
      });
      return out.code === 204
        ? reply.code(204).send()
        : reply.code(out.code).send(out.body);
    },
  );
}
