import type { FastifyInstance, FastifyReply } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * The morning-after report, per mockups/organiser-plans-reports-team.html.
 *
 * "You get a report: who came, who didn't, when people arrived, which gate
 * they used, and anyone turned away." — the public FAQ makes that promise,
 * so all five are here.
 *
 * Two things the handoff singles out:
 *
 *   · every refusal is recorded and shown. Phase-4c calls that log one of
 *     the things organisers value most, and it is the reason refusals are
 *     written with admitted_count 0 rather than dropped.
 *
 *   · manual check-ins are flagged. Name-search entry is the most abusable
 *     action in the system, so the report says which households came in
 *     that way and how many times.
 *
 * Everything is derived. Nothing about attendance is a stored flag, so a
 * report is a query, never a snapshot that can drift.
 */

const ADMITTING = ["admitted", "partial", "manual", "overflow_admitted", "re_entry"];
const REFUSALS = [
  "allowance_exhausted", "invalid", "wrong_event", "wrong_leg", "revoked",
  "rsvp_blocked", "rsvp_declined", "overflow_blocked", "not_found",
];

const HALF_HOUR = 1800;

type LegReport = Awaited<ReturnType<typeof legReport>>;

async function legReport(db: Db, legId: string) {
  const [leg] = await db`
    select id, name, starts_at, venue_name from event_legs where id = ${legId}`;

  const [totals] = await db`
    select
      count(*)::int                                        as invitations,
      coalesce(sum(il.allowance), 0)::int                   as invited_people,
      coalesce(sum(il.rsvp_count) filter (
        where il.rsvp in ('attending','partial')), 0)::int   as confirmed_people,
      count(*) filter (where il.rsvp <> 'pending')::int      as replied
    from invitation_legs il
    where il.leg_id = ${legId}`;

  // Per household: what they were entitled to, what they promised, and who
  // actually walked in. The building block for arrivals, no-shows and
  // overflow alike.
  const households = await db`
    select
      i.id            as invitation_id,
      i.display_name,
      i.primary_phone,
      gc.name         as category,
      st.name         as table_name,
      il.allowance,
      il.rsvp,
      il.rsvp_count,
      coalesce(a.admitted, 0)::int as admitted,
      coalesce(a.manual_scans, 0)::int as manual_scans,
      a.first_arrival,
      a.last_arrival,
      a.entrances
    from invitation_legs il
    join invitations i on i.id = il.invitation_id
    left join guest_categories gc on gc.id = i.category_id
    left join seating_tables st   on st.id = il.table_id
    left join passes p on p.invitation_id = i.id
    left join lateral (
      select
        sum(c.admitted_count)                                  as admitted,
        count(*) filter (where c.result = 'manual')             as manual_scans,
        min(c.recorded_at)                                      as first_arrival,
        max(c.recorded_at)                                      as last_arrival,
        string_agg(distinct en.name, ', ' order by en.name)     as entrances
      from check_in_events c
      left join entrances en on en.id = c.entrance_id
      where c.pass_id = p.id and c.leg_id = il.leg_id
        and c.result in ${db(ADMITTING)}
    ) a on true
    where il.leg_id = ${legId}
    order by i.display_name`;

  const arrivedPeople = households.reduce((n, h) => n + h.admitted, 0);
  // "Confirmed, didn't come" — counted in people, not households, because
  // that is the number the caterer was given.
  const noShows = households.reduce(
    (n, h) =>
      h.rsvp === "attending" || h.rsvp === "partial"
        ? n + Math.max(0, (h.rsvp_count ?? h.allowance) - h.admitted)
        : n,
    0,
  );
  const overflow = households.reduce(
    (acc, h) => {
      const over = Math.max(0, h.admitted - h.allowance);
      return over > 0 ? { people: acc.people + over, parties: acc.parties + 1 } : acc;
    },
    { people: 0, parties: 0 },
  );

  const arrivals = await db`
    select
      to_timestamp(floor(extract(epoch from c.recorded_at) / ${HALF_HOUR}) * ${HALF_HOUR}) as from_ts,
      sum(c.admitted_count)::int as count
    from check_in_events c
    where c.leg_id = ${legId} and c.result in ${db(ADMITTING)}
    group by 1 order by 1`;

  const byEntrance = await db`
    select
      en.id   as entrance_id,
      en.name,
      coalesce(sum(c.admitted_count) filter (
        where c.result in ${db(ADMITTING)}), 0)::int as admitted,
      count(*) filter (where c.result in ${db(REFUSALS)})::int as refused,
      max(c.recorded_at) as last_seen_at,
      (select string_agg(distinct u.full_name, ', ')
       from staff_assignments sa join users u on u.id = sa.user_id
       where sa.entrance_id = en.id) as ushers,
      (select to_timestamp(floor(extract(epoch from c2.recorded_at) / ${HALF_HOUR}) * ${HALF_HOUR})
       from check_in_events c2
       where c2.entrance_id = en.id and c2.result in ${db(ADMITTING)}
       group by 1
       order by sum(c2.admitted_count) desc, 1
       limit 1) as busiest_from
    from entrances en
    left join check_in_events c on c.entrance_id = en.id
    where en.leg_id = ${legId}
    group by en.id, en.name
    order by admitted desc, en.name`;

  // Every refusal, with the human detail that makes it resolvable.
  const refusals = await db`
    select
      c.id, c.result, c.recorded_at, c.admitted_count,
      coalesce(i.display_name, '—') as display_name,
      en.name as entrance_name,
      u.full_name as staff_name,
      c.note
    from check_in_events c
    left join invitations i on i.id = c.invitation_id
    left join entrances en  on en.id = c.entrance_id
    left join users u       on u.id = c.staff_user_id
    where c.leg_id = ${legId} and c.result in ${db(REFUSALS)}
    order by c.recorded_at`;

  const [closed] = await db`
    select max(recorded_at) as at from check_in_events where leg_id = ${legId}`;

  const manualHouseholds = households.filter((h) => h.manual_scans > 0);

  return {
    leg_id: legId,
    leg_name: leg!.name,
    starts_at: leg!.starts_at,
    venue_name: leg!.venue_name,
    closed_at: closed?.at ?? null,

    invitations: totals!.invitations,
    invited_people: totals!.invited_people,
    confirmed_people: totals!.confirmed_people,
    replied_invitations: totals!.replied,
    arrived_people: arrivedPeople,
    no_shows: noShows,
    overflow_people: overflow.people,
    overflow_parties: overflow.parties,
    refused: refusals.length,
    manual_check_ins: manualHouseholds.reduce((n, h) => n + h.manual_scans, 0),
    manual_households: manualHouseholds.length,

    arrivals_by_half_hour: arrivals.map((a) => ({
      from: a.from_ts,
      count: a.count,
    })),
    by_entrance: byEntrance,
    refusals,
    households,
  };
}

/** RFC-4180 enough: quote everything, double interior quotes. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return `"${s.replaceAll('"', '""')}"`;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const head = columns.map(csvCell).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")).join("\r\n");
  // BOM so Excel opens Nigerian names and ₦ correctly rather than as mojibake.
  return `﻿${head}\r\n${body}\r\n`;
}

export async function reportRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  app.get<{ Params: { eventId: string }; Querystring: { format?: string; leg_id?: string; kind?: string } }>(
    "/events/:eventId/report",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        const { eventId } = req.params;
        const [ok] = await db`select app_manages_event(${eventId}::uuid) as ok`;
        if (ok?.ok !== true) return forbidden(reply);

        const [event] = await db`
          select id, name, event_type, status from events where id = ${eventId}`;
        const legRows = await db`
          select id from event_legs where event_id = ${eventId} order by sequence`;

        const legs: LegReport[] = [];
        for (const l of legRows) legs.push(await legReport(db, l.id));

        if (req.query.format === "csv") {
          /**
           * Record the run before building it. The reports screen shows
           * "Date Generated" and "Generated By", and this is where those
           * come from — an archive of what really happened rather than a
           * list that looks busy on day one.
           *
           * No file is kept. The export is built from live data every
           * time, so the same report a week apart tells two different
           * true things instead of one stale one.
           */
          await db`
            insert into report_runs (event_id, kind, format, generated_by, row_count)
            values (${eventId}, ${req.query.kind ?? "guests"}, 'csv',
                    ${uid(req)},
                    ${legs.reduce((n, l) => n + l.households.length, 0)})`;

          // One row per household per leg — the shape a spreadsheet wants.
          const rows = legs.flatMap((leg) =>
            leg.households.map((h) => ({
              leg: leg.leg_name,
              household: h.display_name,
              category: h.category,
              phone: h.primary_phone,
              table: h.table_name,
              invited: h.allowance,
              reply: h.rsvp,
              confirmed: h.rsvp_count,
              arrived: h.admitted,
              outcome:
                h.admitted === 0
                  ? h.rsvp === "declined"
                    ? "declined"
                    : "did not come"
                  : h.admitted < h.allowance
                    ? "partly arrived"
                    : h.admitted > h.allowance
                      ? "over allowance"
                      : "all arrived",
              first_arrival: h.first_arrival,
              last_arrival: h.last_arrival,
              gates: h.entrances,
              manual_check_ins: h.manual_scans,
            })),
          );
          const csv = toCsv(rows, [
            "leg", "household", "category", "phone", "table", "invited",
            "reply", "confirmed", "arrived", "outcome", "first_arrival",
            "last_arrival", "gates", "manual_check_ins",
          ]);
          const slug = String(event!.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          return reply
            .header("content-type", "text/csv; charset=utf-8")
            .header("content-disposition", `attachment; filename="${slug}-report.csv"`)
            .send(csv);
        }

        return {
          event_id: event!.id,
          event_name: event!.name,
          event_type: event!.event_type,
          status: event!.status,
          legs: legs.map(({ households, ...rest }) => ({
            ...rest,
            // Household detail is the CSV's job; the JSON report stays a
            // summary so a 500-household event does not ship a megabyte.
            households_counted: households.length,
          })),
        };
      }),
  );

  /** What has been exported, and by whom. */
  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/report-runs",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        const { eventId } = req.params;
        const [ok] = await db`select app_manages_event(${eventId}::uuid) as ok`;
        if (ok?.ok !== true) return forbidden(reply);

        const runs = await db`
          select r.id, r.kind, r.format, r.generated_at, r.row_count,
                 u.full_name as generated_by
          from report_runs r
          left join users u on u.id = r.generated_by
          where r.event_id = ${eventId}
          order by r.generated_at desc
          limit 50`;

        const [counts] = await db`
          select count(*)::int as total,
                 count(distinct kind)::int as kinds,
                 max(generated_at) as last_at
          from report_runs where event_id = ${eventId}`;

        return { runs, counts };
      }),
  );
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ code: "forbidden", message: "Not your event." });
}
