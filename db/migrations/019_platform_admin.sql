-- The platform administrator: us, looking at our own business.
--
-- Every role until now has been scoped INSIDE a workspace — owner,
-- event_manager, usher — and every RLS policy narrows rows to workspaces
-- you own or belong to. That is the guarantee the whole product rests on:
-- one couple cannot see another couple's wedding. A super admin is the
-- first thing that deliberately steps outside it, so it is worth being
-- precise about exactly how far outside.
--
-- WHAT THIS ROLE CAN SEE
--   Organisers, workspaces, events, and payments — the shape of the
--   business. Names of events, who runs them, what they paid, how many
--   people they invited as a NUMBER.
--
-- WHAT IT DELIBERATELY CANNOT SEE, and this is the point:
--   invitations, invitation_legs, passes, check_in_events, seating_tables.
--   The guest list is the private part of somebody's wedding. An admin
--   dashboard needs to know an event has 743 guests; it does not need to
--   know that one of them is Mrs Adeyemi on +2348034112098. No grant is
--   issued on those tables at all, so this is enforced by the absence of
--   permission rather than by remembering not to write the query.
--
--   signing_key, like every other application role. Only app_verify reads
--   it, and only to check an HMAC.
--
-- Support screens that show a real guest list would be a separate, explicit
-- decision with its own grants and its own audit trail. Not this migration.

alter table users
  add column if not exists is_platform_admin boolean not null default false;

comment on column users.is_platform_admin is
  'Sees the whole platform through app_admin: aggregates, organisers, '
  'events and payments. Never guest data. Grant with '
  'scripts/platform-admin.ts, never through an API.';

-- Partial index: there will be two or three of these among many thousands
-- of users, and every admin request checks the flag.
create index if not exists users_platform_admin_idx
  on users (id) where is_platform_admin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_admin') then
    -- Password is replaced in production the same way the other five are
    -- (DEPLOY.md §2). Dev value matches the convention in 003_rls.sql.
    create role app_admin login password 'app_admin_dev_only';
  end if;
end $$;

-- Read-only throughout. An administrator looking at the business has no
-- reason to write to a customer's row, and the way to guarantee that is to
-- withhold INSERT, UPDATE and DELETE rather than to be careful.
grant select (id, full_name, phone, email, created_at, last_seen_at,
              is_platform_admin) on users to app_admin;
grant select on workspaces to app_admin;
grant select (id, workspace_id, name, event_type, status, plan, people_limit,
              paid_at, created_at, updated_at, end_date, timezone, public_page)
  on events to app_admin;
grant select (id, event_id, name, sequence, starts_at, venue_name, city)
  on event_legs to app_admin;
grant select on payments to app_admin;

-- The tables above carry RLS, so a grant alone still returns nothing. These
-- policies are what open them, and each is SELECT-only.
alter table workspaces enable row level security;
create policy ws_admin on workspaces for select to app_admin using (true);
create policy ev_admin on events for select to app_admin using (true);
create policy leg_admin on event_legs for select to app_admin using (true);
create policy pay_admin on payments for select to app_admin using (true);

-- users has no RLS by design (003_rls.sql: the login path has no user
-- context yet), so the column grant above is the whole of its story.

-- Counting guests without reading them. The dashboard wants "743 people
-- across 240 households" and must not be able to name one of them, so the
-- count is a SECURITY DEFINER function: it runs as its owner, returns
-- integers, and app_admin still holds no grant on the tables underneath.
create or replace function admin_event_size(p_event uuid)
returns table (households int, people int)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(distinct il.invitation_id)::int as households,
    coalesce(sum(il.allowance), 0)::int   as people
  from invitation_legs il
  join event_legs l on l.id = il.leg_id
  where l.event_id = p_event;
$$;

revoke all on function admin_event_size(uuid) from public;
grant execute on function admin_event_size(uuid) to app_admin;
