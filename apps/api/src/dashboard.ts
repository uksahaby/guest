import type { FastifyInstance, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * Everything the organiser's home screen shows, in one request.
 *
 * A dashboard that fires nine queries from the browser is a dashboard that
 * looks broken on Nigerian mobile data — each panel arriving separately,
 * the layout jumping as it goes. This is server-rendered from one call.
 *
 * Two things it deliberately does not do:
 *
 *   · No percentage of readiness. `spec/event-readiness-rules.md` argues
 *     the case at length: "82% ready" tells an organiser nothing they can
 *     act on, where "31 households haven't replied → send reminders" does.
 *     The state is one of four words and the list is sorted by urgency.
 *
 *   · No invented numbers. Every figure here is a query. Where there is
 *     nothing to compare against — an organiser's first event has no
 *     previous one — the comparison is omitted rather than shown as zero.
 */

const ADMITTING = ["admitted", "partial", "manual", "overflow_admitted", "re_entry"];

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

export type ReadinessItem = {
  check: number;
  /** The fact, with its number first. */
  fact: string;
  /** What to do about it. */
  action: string;
  href: string;
  /** Past its urgent point — shown above the rest under "Due now". */
  urgent: boolean;
};

export type ReadinessState =
  | "setting_up"
  | "on_track"
  | "needs_attention"
  | "ready"
  | "complete";

const DAY = 24 * 3600 * 1000;

/** Days from now until the event. Negative once it has happened. */
function daysUntil(startsAt: Date | null): number {
  if (!startsAt) return 9999;
  return Math.ceil((startsAt.getTime() - Date.now()) / DAY);
}

/**
 * The nine checks from the spec, with their windows.
 *
 * A check is only listed once it starts mattering: showing twelve weeks of
 * future tasks on day one is how a dashboard becomes something people stop
 * opening. Anything past its urgent point is flagged rather than hidden.
 */
export function readiness(
  days: number,
  f: {
    eventId: string;
    hasDetails: boolean;
    invitations: number;
    linked: number;
    replied: number;
    unassigned: number;
    usesTables: boolean;
    entrances: number;
    staff: number;
    testScans: number;
    passes: number;
    peopleLimit: number;
  },
): { state: ReadinessState; items: ReadinessItem[] } {
  const e = `/events/${f.eventId}`;
  const items: ReadinessItem[] = [];

  // (check, passes, startsMattering, urgentAt, fact, action, href)
  const defs: [number, boolean, number, number, string, string, string][] = [
    [1, f.hasDetails, 9999, 9999, "The event still needs a date or venue", "Finish setup", `${e}/settings`],
    [2, f.invitations > 0, 9999, 56, "No guests on the list yet", "Add or import guests", `${e}/guests/import`],
    [3, f.invitations > 0 && f.linked / f.invitations >= 0.9, 42, 21,
      `${f.invitations - f.linked} households have no invitation link`, "Send invitations", `${e}/guests`],
    [4, f.invitations > 0 && f.replied / f.invitations >= 0.8, 21, 10,
      `${f.invitations - f.replied} households haven't replied`, "Send reminders", `${e}/guests`],
    [5, !f.usesTables || f.unassigned === 0, 14, 3,
      `${f.unassigned} confirmed guests have no table`, "Assign tables", `${e}/tables`],
    [6, f.entrances > 0, 7, 2, "No gate has been created", "Add a gate", `${e}/team`],
    [7, f.staff > 0, 7, 2, "Nobody is assigned to check guests in", "Invite check-in staff", `${e}/team`],
    [8, f.testScans > 0, 3, 1, "No one has tested the scanner", "Ask staff to open the scanner", `${e}/team`],
    [9, f.passes <= f.peopleLimit, 9999, 9999,
      `${f.passes} passes issued against a limit of ${f.peopleLimit}`, "Upgrade the plan", `${e}/billing`],
  ];

  for (const [check, passes, startsAt, urgentAt, fact, action, href] of defs) {
    if (passes) continue;
    if (days > startsAt) continue; // not yet its problem
    items.push({ check, fact, action, href, urgent: days <= urgentAt });
  }

  // Soonest-urgent first, which is not the same as check order.
  items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.check - b.check);

  let state: ReadinessState = "on_track";
  if (days < 0) state = "complete";
  else if (!f.hasDetails || f.invitations === 0) state = "setting_up";
  else if (items.some((i) => i.urgent)) state = "needs_attention";
  else if (items.length === 0 && days <= 7) state = "ready";

  return { state, items };
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/dashboard",
    { preHandler: [app.authenticate] },
    async (req) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        // RLS scopes this to the caller's workspaces; no filter needed here
        // and none would be trusted if it were.
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
        // should still see the one just gone rather than an empty page.
        const now = Date.now();
        const upcoming = events.filter(
          (e) => e.starts_at && new Date(e.starts_at).getTime() >= now,
        );
        const featured = upcoming[0] ?? events[events.length - 1] ?? null;

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

        const id = featured.id;

        const [totals] = await db`
          select
            count(*)::int as invitations,
            coalesce(sum(il.allowance), 0)::int as invited_people,
            coalesce(sum(il.rsvp_count) filter (
              where il.rsvp in ('attending','partial')), 0)::int as confirmed_people,
            count(*) filter (where il.rsvp <> 'pending')::int as replied,
            count(*) filter (where il.rsvp = 'declined')::int as declined,
            count(*) filter (where il.rsvp = 'pending')::int as pending,
            count(*) filter (where il.table_id is not null)::int as seated
          from invitation_legs il
          join invitations i on i.id = il.invitation_id
          where i.event_id = ${id}`;

        const [arrived] = await db`
          select coalesce(sum(c.occupancy_delta), 0)::int as people
          from check_in_events c
          where c.event_id = ${id} and c.result in ${db(ADMITTING)}`;

        const [sent] = await db`
          select count(distinct d.invitation_id)::int as n
          from invitation_deliveries d
          join invitations i on i.id = d.invitation_id
          where i.event_id = ${id} and d.generated_at is not null`;

        const [counts] = await db`
          select
            (select count(*) from seating_tables t
               join event_legs l on l.id = t.leg_id where l.event_id = ${id})::int
              as tables,
            (select count(*) from entrances en
               join event_legs l on l.id = en.leg_id where l.event_id = ${id})::int
              as entrances,
            (select count(*) from staff_assignments s
               join event_legs l on l.id = s.leg_id where l.event_id = ${id})::int
              as staff,
            (select count(*) from staff_assignments s
               join event_legs l on l.id = s.leg_id
               where l.event_id = ${id} and s.last_tested_at is not null)::int
              as tested,
            (select count(*) from passes p
               join invitations i on i.id = p.invitation_id
               where i.event_id = ${id})::int as passes,
            (select count(*) from invitation_legs il
               join invitations i on i.id = il.invitation_id
               where i.event_id = ${id}
                 and il.rsvp in ('attending','partial')
                 and il.table_id is null)::int as unassigned`;

        const [leg] = await db`
          select venue_name, starts_at from event_legs
          where event_id = ${id} order by starts_at limit 1`;

        /**
         * The feed, from the four places the system already timestamps
         * things. There is no activity table and adding one would mean a
         * second source of truth for events already recorded.
         */
        const activity = await db`
          (select 'rsvp' as kind, i.display_name as who,
                  il.rsvp::text as detail, il.responded_at as at
             from invitation_legs il
             join invitations i on i.id = il.invitation_id
            where i.event_id = ${id} and il.responded_at is not null)
          union all
          (select 'checked_in', i.display_name,
                  c.admitted_count::text, c.scanned_at
             from check_in_events c
             join invitations i on i.id = c.invitation_id
            where c.event_id = ${id} and c.result in ${db(ADMITTING)})
          union all
          (select 'opened', i.display_name, null, d.opened_at
             from invitation_deliveries d
             join invitations i on i.id = d.invitation_id
            where i.event_id = ${id} and d.opened_at is not null)
          union all
          (select 'sent', i.display_name, null, d.sent_at
             from invitation_deliveries d
             join invitations i on i.id = d.invitation_id
            where i.event_id = ${id} and d.sent_at is not null)
          order by at desc
          limit 8`;

        const days = daysUntil(leg?.starts_at ?? null);

        return {
          organiser: me?.full_name ?? null,
          events: events.map((e) => ({
            id: e.id,
            name: e.name,
            starts_at: e.starts_at,
            status: e.status,
          })),
          featured: {
            id,
            name: featured.name,
            cover_image_url: featured.cover_image_url,
            starts_at: leg?.starts_at ?? null,
            venue_name: leg?.venue_name ?? null,
            plan: featured.plan,
            days_until: days,
            tables: counts!.tables,
          },
          totals: {
            invited_people: totals!.invited_people,
            invitations: totals!.invitations,
            invitations_sent: sent!.n,
            confirmed_people: totals!.confirmed_people,
            arrived_people: arrived!.people,
          },
          rsvp: {
            confirmed: totals!.invitations - totals!.pending - totals!.declined,
            pending: totals!.pending,
            declined: totals!.declined,
            total: totals!.invitations,
          },
          readiness: readiness(days, {
            eventId: id,
            hasDetails: Boolean(leg?.starts_at && leg?.venue_name),
            invitations: totals!.invitations,
            linked: sent!.n,
            replied: totals!.replied,
            unassigned: counts!.unassigned,
            usesTables: counts!.tables > 0,
            entrances: counts!.entrances,
            staff: counts!.staff,
            testScans: counts!.tested,
            passes: counts!.passes,
            peopleLimit: featured.people_limit,
          }),
          activity,
        };
      }),
  );
}
