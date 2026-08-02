import { type Db } from "./db.ts";
import { readiness, daysUntil, ADMITTING } from "./readiness.ts";

/**
 * Everything about ONE event that a summary screen needs.
 *
 * Shared by the dashboard's featured card and the event overview, because
 * they ask the same questions — and two copies of "how many people have
 * arrived" is how two screens start disagreeing in front of an organiser
 * who is looking at both.
 */
export async function eventSummary(db: Db, id: string, peopleLimit: number) {
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
    select count(distinct d.invitation_id)::int as n,
           max(d.sent_at) as last_sent
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
    select id, name, venue_name, starts_at from event_legs
    where event_id = ${id} order by starts_at limit 1`;

  /**
   * The feed, from the four places the system already timestamps things.
   * There is no activity table, and adding one would create a second
   * source of truth for events that are already recorded.
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
    leg: leg ?? null,
    days_until: days,
    tables: counts!.tables,
    entrances: counts!.entrances,
    staff: counts!.staff,
    totals: {
      invited_people: totals!.invited_people,
      invitations: totals!.invitations,
      invitations_sent: sent!.n,
      last_sent_at: sent!.last_sent ?? null,
      confirmed_people: totals!.confirmed_people,
      arrived_people: arrived!.people,
      seated: totals!.seated,
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
      peopleLimit,
    }),
    activity,
  };
}
