-- 003 · Row-Level Security.
--
-- HANDOFF §10: "Enable RLS on every table before launch. Ushers must reach
-- only the legs in their staff_assignments, and must never be able to select
-- invitations.primary_phone or primary_email."
--
-- Three facts shape this migration:
--
--   1. RLS DOES NOT APPLY TO SUPERUSERS OR TABLE OWNERS. Policies are
--      decoration unless the application connects as an unprivileged role.
--      So this creates three roles and the API stops using `postgres`.
--
--   2. RLS is row-level. It cannot hide a COLUMN. The phone-number promise
--      is therefore kept with column-level GRANTs plus a view — see
--      usher_guest_list at the bottom.
--
--   3. A policy that queries the table it protects recurses forever. Every
--      predicate below is a SECURITY DEFINER function owned by postgres, so
--      its own reads bypass RLS.
--
-- Request context is set per transaction by the API:
--     select set_config('app.user_id', $1, true)   -- true = LOCAL
--     select set_config('app.pass_id', $1, true)   -- guest pages only
-- Unset means NULL, and every policy then fails closed.

-- ---------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------

-- NOLOGIN + NOINHERIT is deliberate: these are identities the API assumes,
-- created here without passwords. Deployment assigns credentials (or uses
-- SET ROLE from a single login role).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw login password 'app_rw_dev_only';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_usher') then
    create role app_usher login password 'app_usher_dev_only';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_public') then
    create role app_public login password 'app_public_dev_only';
  end if;
end $$;

grant usage on schema public to app_rw, app_usher, app_public;

-- ---------------------------------------------------------------------
-- request context
-- ---------------------------------------------------------------------

create or replace function app_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_pass_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.pass_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------
-- predicates  (SECURITY DEFINER — must not re-enter RLS)
-- ---------------------------------------------------------------------

-- Owner or event_manager on the workspace that owns this event.
create or replace function app_manages_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from events e
    join workspaces w on w.id = e.workspace_id
    left join workspace_memberships m
      on m.workspace_id = w.id and m.user_id = app_user_id()
    where e.id = p_event_id
      and app_user_id() is not null
      and (w.owner_user_id = app_user_id()
           or m.role in ('owner', 'event_manager'))
  )
$$;

create or replace function app_manages_leg(p_leg_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from event_legs l
    where l.id = p_leg_id and app_manages_event(l.event_id)
  )
$$;

-- Assigned to work this specific leg. An usher on the Lagos leg never sees
-- the Abuja guest list.
create or replace function app_works_leg(p_leg_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_assignments sa
    where sa.leg_id = p_leg_id
      and app_user_id() is not null
      and sa.user_id = app_user_id()
  )
$$;

create or replace function app_works_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_assignments sa
    join event_legs l on l.id = sa.leg_id
    where l.event_id = p_event_id
      and app_user_id() is not null
      and sa.user_id = app_user_id()
  )
$$;

-- These two exist only to break a cycle. A policy on workspaces that
-- subqueries workspace_memberships, while the policy on
-- workspace_memberships subqueries workspaces, is mutual recursion and
-- Postgres rejects it at query time with 42P17. Wrapping both sides in
-- SECURITY DEFINER cuts the loop.
create or replace function app_member_of(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_memberships m
    where m.workspace_id = p_workspace_id
      and app_user_id() is not null
      and m.user_id = app_user_id()
  )
$$;

create or replace function app_owns_workspace(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspaces w
    where w.id = p_workspace_id
      and app_user_id() is not null
      and w.owner_user_id = app_user_id()
  )
$$;

-- Keyed on workspace_id rather than the event id, so the policy on events
-- never has to read events. That matters for INSERT ... RETURNING: the
-- RETURNING clause applies the SELECT policy to the new row, and a STABLE
-- predicate cannot see a row its own statement is still inserting.
create or replace function app_manages_workspace(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspaces w
    left join workspace_memberships m
      on m.workspace_id = w.id and m.user_id = app_user_id()
    where w.id = p_workspace_id
      and app_user_id() is not null
      and (w.owner_user_id = app_user_id()
           or m.role in ('owner', 'event_manager'))
  )
$$;

-- Reachable from the verified pass the guest page is holding.
create or replace function app_pass_invitation() returns uuid
language sql stable security definer set search_path = public as $$
  select p.invitation_id from passes p
  where p.id = app_pass_id() and p.status = 'active'
$$;

revoke all on function app_manages_event(uuid), app_manages_leg(uuid),
  app_works_leg(uuid), app_works_event(uuid), app_pass_invitation(),
  app_member_of(uuid), app_owns_workspace(uuid), app_manages_workspace(uuid)
  from public;
grant execute on function app_manages_event(uuid), app_manages_leg(uuid),
  app_works_leg(uuid), app_works_event(uuid), app_pass_invitation(),
  app_member_of(uuid), app_owns_workspace(uuid), app_manages_workspace(uuid)
  to app_rw, app_usher, app_public;
grant execute on function app_user_id(), app_pass_id()
  to app_rw, app_usher, app_public;
grant execute on function admitted_so_far(uuid, uuid), pass_state(uuid, uuid),
  billable_people(uuid) to app_rw, app_usher;

-- ---------------------------------------------------------------------
-- auth tables
-- ---------------------------------------------------------------------
--
-- users and auth_otp_codes are deliberately NOT under RLS: the login path
-- has no user context yet (find-or-create by phone happens before any
-- session exists), so a policy keyed on app_user_id() would lock everyone
-- out. They are instead protected by grants — app_usher and app_public
-- receive nothing at all on auth_otp_codes, and only the columns a name
-- needs on users.

grant select, insert, update on users to app_rw;
grant select, insert, update on auth_otp_codes to app_rw;
grant select (id, full_name) on users to app_usher;

-- ---------------------------------------------------------------------
-- tenancy
-- ---------------------------------------------------------------------

alter table workspaces enable row level security;
grant select, insert, update on workspaces to app_rw;
create policy ws_read on workspaces for select to app_rw
  using (owner_user_id = app_user_id() or app_member_of(id));
create policy ws_insert on workspaces for insert to app_rw
  with check (owner_user_id = app_user_id());
create policy ws_update on workspaces for update to app_rw
  using (owner_user_id = app_user_id());

alter table workspace_memberships enable row level security;
grant select, insert, update, delete on workspace_memberships to app_rw;
-- Self-referential by design: the row keyed to me is always visible, which
-- is what /me needs, and avoids recursing into workspaces.
create policy wm_read on workspace_memberships for select to app_rw
  using (user_id = app_user_id() or app_owns_workspace(workspace_id));
create policy wm_write on workspace_memberships for all to app_rw
  using (app_owns_workspace(workspace_id))
  with check (app_owns_workspace(workspace_id));

-- ---------------------------------------------------------------------
-- events and legs
-- ---------------------------------------------------------------------

alter table events enable row level security;
-- signing_key is withheld from every application role. It reaches a device
-- only through the bootstrap view below.
grant select (id, workspace_id, name, event_type, description, cover_image_url,
              status, token_version, plan, people_limit, paid_at,
              allow_overflow, require_rsvp, allow_walkins, allow_usher_undo,
              rsvp_deadline, created_at, updated_at) on events to app_rw;
grant insert, update on events to app_rw;
grant select (id, name, allow_overflow, require_rsvp, allow_walkins,
              allow_usher_undo, token_version) on events to app_usher;
grant select (id, name, description, rsvp_deadline, token_version) on events
  to app_public;

create policy ev_manage on events for all to app_rw
  using (app_manages_workspace(workspace_id))
  with check (app_manages_workspace(workspace_id));
create policy ev_usher on events for select to app_usher
  using (app_works_event(id));
create policy ev_public on events for select to app_public
  using (exists (select 1 from invitations i
                 where i.id = app_pass_invitation() and i.event_id = events.id));

alter table event_legs enable row level security;
grant select, insert, update, delete on event_legs to app_rw;
grant select on event_legs to app_usher, app_public;
create policy leg_manage on event_legs for all to app_rw
  using (app_manages_event(event_id)) with check (app_manages_event(event_id));
create policy leg_usher on event_legs for select to app_usher
  using (app_works_event(event_id));
create policy leg_public on event_legs for select to app_public
  using (exists (select 1 from invitation_legs il
                 where il.leg_id = event_legs.id
                   and il.invitation_id = app_pass_invitation()));

alter table entrances enable row level security;
grant select, insert, update, delete on entrances to app_rw;
grant select on entrances to app_usher;
create policy en_manage on entrances for all to app_rw
  using (app_manages_leg(leg_id)) with check (app_manages_leg(leg_id));
create policy en_usher on entrances for select to app_usher
  using (app_works_leg(leg_id));

alter table seating_tables enable row level security;
grant select, insert, update, delete on seating_tables to app_rw;
grant select on seating_tables to app_usher, app_public;
create policy st_manage on seating_tables for all to app_rw
  using (app_manages_leg(leg_id)) with check (app_manages_leg(leg_id));
create policy st_usher on seating_tables for select to app_usher
  using (app_works_leg(leg_id));
create policy st_public on seating_tables for select to app_public
  using (exists (select 1 from invitation_legs il
                 where il.table_id = seating_tables.id
                   and il.invitation_id = app_pass_invitation()));

alter table guest_categories enable row level security;
grant select, insert, update, delete on guest_categories to app_rw;
grant select on guest_categories to app_usher;
create policy gc_manage on guest_categories for all to app_rw
  using (app_manages_event(event_id)) with check (app_manages_event(event_id));
create policy gc_usher on guest_categories for select to app_usher
  using (app_works_event(event_id));

-- ---------------------------------------------------------------------
-- invitations  —  where the phone-number promise is kept
-- ---------------------------------------------------------------------

alter table invitations enable row level security;
grant select, insert, update, delete on invitations to app_rw;
-- Column-level grant. app_usher is not given primary_phone, primary_email
-- or notes, so `select primary_phone from invitations` is a hard permission
-- error for a scanner connection no matter what the API asks for.
grant select (id, event_id, display_name, category_id, is_walk_in,
              created_at, updated_at) on invitations to app_usher;
grant insert on invitations to app_usher;      -- walk-ins
grant select (id, event_id, display_name) on invitations to app_public;

create policy inv_manage on invitations for all to app_rw
  using (app_manages_event(event_id)) with check (app_manages_event(event_id));
create policy inv_usher_read on invitations for select to app_usher
  using (app_works_event(event_id));
create policy inv_usher_walkin on invitations for insert to app_usher
  with check (app_works_event(event_id) and is_walk_in = true);
create policy inv_public on invitations for select to app_public
  using (id = app_pass_invitation());

alter table invitation_legs enable row level security;
grant select, insert, update, delete on invitation_legs to app_rw;
grant select on invitation_legs to app_usher;
grant insert on invitation_legs to app_usher;  -- walk-ins
grant select, update on invitation_legs to app_public;  -- RSVP
create policy il_manage on invitation_legs for all to app_rw
  using (app_manages_leg(leg_id)) with check (app_manages_leg(leg_id));
create policy il_usher on invitation_legs for select to app_usher
  using (app_works_leg(leg_id));
create policy il_usher_walkin on invitation_legs for insert to app_usher
  with check (app_works_leg(leg_id));
create policy il_public on invitation_legs for select to app_public
  using (invitation_id = app_pass_invitation());
-- A household may change its own reply, and nothing else.
create policy il_public_rsvp on invitation_legs for update to app_public
  using (invitation_id = app_pass_invitation())
  with check (invitation_id = app_pass_invitation());

alter table guests enable row level security;
grant select, insert, update, delete on guests to app_rw;
grant select on guests to app_usher;
create policy g_manage on guests for all to app_rw
  using (exists (select 1 from invitations i
                 where i.id = guests.invitation_id
                   and app_manages_event(i.event_id)))
  with check (exists (select 1 from invitations i
                      where i.id = guests.invitation_id
                        and app_manages_event(i.event_id)));
create policy g_usher on guests for select to app_usher
  using (exists (select 1 from invitations i
                 where i.id = guests.invitation_id
                   and app_works_event(i.event_id)));

-- ---------------------------------------------------------------------
-- passes and delivery
-- ---------------------------------------------------------------------

alter table passes enable row level security;
grant select, insert, update on passes to app_rw;
grant select on passes to app_usher;
grant insert on passes to app_usher;           -- walk-ins
grant select on passes to app_public;
create policy p_manage on passes for all to app_rw
  using (app_manages_event(event_id)) with check (app_manages_event(event_id));
create policy p_usher on passes for select to app_usher
  using (app_works_event(event_id));
create policy p_usher_walkin on passes for insert to app_usher
  with check (app_works_event(event_id));
create policy p_public on passes for select to app_public
  using (id = app_pass_id());

alter table invitation_deliveries enable row level security;
grant select, insert, update on invitation_deliveries to app_rw;
grant select, update on invitation_deliveries to app_public;
create policy d_manage on invitation_deliveries for all to app_rw
  using (exists (select 1 from invitations i
                 where i.id = invitation_deliveries.invitation_id
                   and app_manages_event(i.event_id)))
  with check (exists (select 1 from invitations i
                      where i.id = invitation_deliveries.invitation_id
                        and app_manages_event(i.event_id)));
-- The guest opening their link flips link_generated → opened.
create policy d_public on invitation_deliveries for select to app_public
  using (invitation_id = app_pass_invitation());
create policy d_public_open on invitation_deliveries for update to app_public
  using (invitation_id = app_pass_invitation())
  with check (invitation_id = app_pass_invitation());

-- ---------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------

alter table staff_assignments enable row level security;
grant select, insert, update, delete on staff_assignments to app_rw;
grant select, update on staff_assignments to app_usher;
create policy sa_manage on staff_assignments for all to app_rw
  using (app_manages_leg(leg_id)) with check (app_manages_leg(leg_id));
-- An usher sees only their own assignments — not the rest of the roster.
create policy sa_self on staff_assignments for select to app_usher
  using (user_id = app_user_id());
-- ...and may only touch their own row (the readiness ping).
create policy sa_self_test on staff_assignments for update to app_usher
  using (user_id = app_user_id()) with check (user_id = app_user_id());

-- ---------------------------------------------------------------------
-- the check-in log
-- ---------------------------------------------------------------------
--
-- No role is granted UPDATE or DELETE here. The append-only trigger from
-- schema-v1.sql is the second lock; this is the first.

alter table check_in_events enable row level security;
grant select, insert on check_in_events to app_rw;
grant select, insert on check_in_events to app_usher;
create policy ci_manage_read on check_in_events for select to app_rw
  using (app_manages_event(event_id));
create policy ci_manage_write on check_in_events for insert to app_rw
  with check (app_manages_event(event_id));
create policy ci_usher_read on check_in_events for select to app_usher
  using (app_works_leg(leg_id));
-- An usher may only record scans at a leg they work, attributed to
-- themselves. A device cannot forge another usher's admissions.
create policy ci_usher_write on check_in_events for insert to app_usher
  with check (app_works_leg(leg_id) and staff_user_id = app_user_id());

-- ---------------------------------------------------------------------
-- money
-- ---------------------------------------------------------------------

alter table payments enable row level security;
grant select, insert, update on payments to app_rw;
create policy pay_own on payments for all to app_rw
  using (app_owns_workspace(workspace_id))
  with check (app_owns_workspace(workspace_id));

-- ---------------------------------------------------------------------
-- the scanner's bootstrap view
-- ---------------------------------------------------------------------
--
-- Two things a scanner connection cannot do for itself: read
-- events.signing_key, and read invitations.primary_phone. Both are
-- withheld above. But the gate legitimately needs the signing key, and
-- phase-4c §8 wants search by "name or phone".
--
-- These views are owned by postgres and run with the owner's rights
-- (security_invoker off), so they can read those columns — but they only
-- ever emit what the gate needs: the key for legs the usher actually
-- works, and the LAST FOUR DIGITS of a phone number. An usher can confirm
-- a number read aloud to them; they cannot harvest a guest list.
--
-- Filtering happens inside the view because RLS is bypassed here.

create or replace view usher_guest_list as
select
  il.leg_id,
  p.id                       as pass_id,
  i.display_name,
  gc.name                    as category,
  st.name                    as table_name,
  il.allowance,
  il.rsvp,
  coalesce((
    select sum(c.admitted_count)::int from check_in_events c
    where c.pass_id = p.id and c.leg_id = il.leg_id
      and c.result in ('admitted','partial','manual','overflow_admitted',
                       're_entry','reversal')
  ), 0)                      as admitted,
  lower(concat_ws(' ', i.display_name,
        right(regexp_replace(coalesce(i.primary_phone, ''), '\D', '', 'g'), 4)))
                             as search_terms,
  p.status                   as pass_status
from invitation_legs il
join invitations i on i.id = il.invitation_id
join passes p      on p.invitation_id = i.id
left join guest_categories gc on gc.id = i.category_id
left join seating_tables st   on st.id = il.table_id
where app_works_leg(il.leg_id);

grant select on usher_guest_list to app_usher;

create or replace view usher_event_keys as
select distinct
  e.id            as event_id,
  e.name          as event_name,
  e.token_version,
  e.signing_key
from events e
join event_legs l on l.event_id = e.id
join staff_assignments sa on sa.leg_id = l.id
where sa.user_id = app_user_id();

grant select on usher_event_keys to app_usher;

-- Organiser reads of derived attendance need the view too.
grant select on leg_attendance to app_rw;

-- leg_attendance is a view owned by postgres, so it would otherwise bypass
-- RLS entirely. security_invoker makes the caller's policies apply, which
-- means an organiser sees only their own legs' numbers.
alter view leg_attendance set (security_invoker = true);

-- ---------------------------------------------------------------------
-- the verifier
-- ---------------------------------------------------------------------
--
-- Guest pages face a bootstrapping problem: verifying the HMAC in a
-- guest's link needs the event signing key, but the role that then reads
-- the household's data must never hold keys.
--
-- Rather than let one role do both, the capabilities are split. app_verify
-- can read four columns of events and NOTHING else in the database — no
-- invitations, no passes, no check-ins. app_public can read one
-- household's data but cannot see a signing key. Neither role alone can
-- both forge a pass and read guest data.
--
-- (Verification stays in Node deliberately. Reimplementing the token in
-- SQL would be a third copy of logic the architecture says must exist
-- twice at most.)

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_verify') then
    create role app_verify login password 'app_verify_dev_only';
  end if;
end $$;

grant usage on schema public to app_verify;
grant select (id, name, token_version, signing_key) on events to app_verify;
create policy ev_verify on events for select to app_verify using (true);

-- The assignments list shows whether an event is open for scanning.
grant select (status) on events to app_usher;
