-- =====================================================================
--  SCHEMA v1  ·  PostgreSQL 15+
--
--  Core shape:
--    workspace → event → leg → entrance / table
--    event → invitation (a household) → invitation_leg (allowance per leg)
--    invitation → pass (one) → check_in_events (append-only)
--
--  Two rules that drive everything below:
--    1. Every event has at least one leg. A single-venue wedding has one
--       leg and the UI never says the word. No nullable branching.
--    2. Nothing about attendance is stored as a mutable flag. Admission
--       is a SUM over an append-only log, which is what lets two offline
--       phones reconcile without a conflict.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------

create type workspace_role   as enum ('owner','event_manager','usher');
create type event_status     as enum ('draft','active','completed','cancelled');
create type rsvp_status      as enum ('pending','attending','partial','declined');
create type pass_status      as enum ('active','revoked');
create type delivery_channel as enum ('whatsapp_link','email','sms','manual');
create type delivery_state   as enum ('not_sent','link_generated','sent','opened');
create type payment_status   as enum ('pending','successful','failed','refunded');
create type plan_code        as enum ('free','small','standard','large','grand',
                                      'professional','organisation');

-- Every outcome from the Phase 4C state machine, plus the two deferred
-- ones (re_entry, checked_out) so adding them later needs no migration.
create type checkin_result as enum (
  -- admitting
  'admitted','partial','manual','overflow_admitted','re_entry',
  -- corrections
  'reversal','checked_out',
  -- refusing
  'allowance_exhausted','invalid','wrong_event','wrong_leg','revoked',
  'rsvp_blocked','rsvp_declined','overflow_blocked','not_found'
);

-- ---------------------------------------------------------------------
-- people & tenancy
-- ---------------------------------------------------------------------

create table users (
  id             uuid primary key default gen_random_uuid(),
  phone          text unique not null,          -- E.164. Primary identifier.
  email          text unique,                   -- optional throughout
  full_name      text not null,
  password_hash  text,                          -- null = OTP-only (all ushers)
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz
);

create table workspaces (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner_user_id  uuid not null references users(id),
  -- true until the user creates a second workspace or invites a team member.
  -- While implicit the UI hides the concept entirely.
  is_implicit    boolean not null default true,
  logo_url       text,
  created_at     timestamptz not null default now()
);

create table workspace_memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         workspace_role not null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index on workspace_memberships (user_id);

-- ---------------------------------------------------------------------
-- events and their legs
-- ---------------------------------------------------------------------

create table events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,
  event_type      text not null default 'wedding',
  description     text,
  cover_image_url text,
  status          event_status not null default 'draft',

  -- HMAC secret for this event's passes. Encrypt at rest; never returned
  -- by any API that a browser can reach. Goes to scanner devices only.
  signing_key     bytea not null,
  token_version   int not null default 1,       -- bump to invalidate every pass

  -- entitlement (see billable_people() below)
  plan            plan_code not null default 'free',
  people_limit    int not null default 150,
  paid_at         timestamptz,

  -- entry policy, per Phase 4C
  allow_overflow  boolean not null default true,
  require_rsvp    boolean not null default false,
  allow_walkins   boolean not null default true,
  allow_usher_undo boolean not null default true,

  rsvp_deadline   date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on events (workspace_id, status);

-- A leg is one venue on one date. Traditional in Abuja, white in Lagos.
-- Single-venue events have exactly one, created automatically.
create table event_legs (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  name           text not null,                 -- 'Traditional Ceremony'
  sequence       int  not null,                 -- ordering, 1-based
  starts_at      timestamptz not null,
  doors_close_at timestamptz,
  venue_name     text,
  address_line   text,
  city           text,
  country        text default 'NG',
  latitude       numeric(9,6),
  longitude      numeric(9,6),
  tables_enabled boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (event_id, sequence)
);

create index on event_legs (event_id, starts_at);

create table entrances (
  id         uuid primary key default gen_random_uuid(),
  leg_id     uuid not null references event_legs(id) on delete cascade,
  name       text not null,                     -- 'Main Gate'
  is_active  boolean not null default true,
  unique (leg_id, name)
);

create table seating_tables (
  id        uuid primary key default gen_random_uuid(),
  leg_id    uuid not null references event_legs(id) on delete cascade,
  name      text not null,                      -- 'Table 12', 'VIP Table'
  capacity  int not null check (capacity > 0),
  unique (leg_id, name)
);

-- Categories are event-wide. "Groom's Family" means the same at both legs.
create table guest_categories (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  name      text not null,
  colour    text,
  unique (event_id, name)
);

-- ---------------------------------------------------------------------
-- invitations — the unit of everything
-- ---------------------------------------------------------------------

-- One row per household. "Mr & Mrs Adeyemi", not four rows of people.
create table invitations (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  display_name   text not null,                 -- exactly as written on a card
  primary_phone  text,                          -- for the WhatsApp link
  primary_email  text,
  category_id    uuid references guest_categories(id) on delete set null,
  notes          text,
  is_walk_in     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on invitations (event_id);
create index on invitations (event_id, primary_phone);

-- The household's entitlement AT A GIVEN LEG. A family invited for six at
-- the traditional and two at the white wedding is two rows.
-- Absence of a row means not invited to that leg.
create table invitation_legs (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references invitations(id) on delete cascade,
  leg_id        uuid not null references event_legs(id) on delete cascade,
  allowance     int  not null check (allowance > 0),
  rsvp          rsvp_status not null default 'pending',
  rsvp_count    int check (rsvp_count >= 0),    -- how many of allowance confirmed
  responded_at  timestamptz,
  table_id      uuid references seating_tables(id) on delete set null,
  unique (invitation_id, leg_id)
);

create index on invitation_legs (leg_id, rsvp);
create index on invitation_legs (table_id);

-- Named individuals. Entirely optional — an invitation with allowance 6 and
-- zero guest rows is a complete, valid record and will be the common case
-- straight after a CSV import.
create table guests (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references invitations(id) on delete cascade,
  first_name    text not null,
  last_name     text,
  is_primary    boolean not null default false
);

create index on guests (invitation_id);

-- ---------------------------------------------------------------------
-- passes
-- ---------------------------------------------------------------------

-- ONE pass per household, covering the whole event. The guest keeps a single
-- QR code that works at both legs. Which leg it admits them to, and for how
-- many, is resolved against invitation_legs at scan time — the scanner has
-- that data locally, so this still works offline.
create table passes (
  id             uuid primary key default gen_random_uuid(),
  invitation_id  uuid not null unique references invitations(id) on delete cascade,
  event_id       uuid not null references events(id) on delete cascade,
  token_version  int not null default 1,
  status         pass_status not null default 'active',
  issued_at      timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_reason text
);

create index on passes (event_id, status);

-- Delivery attempts. WhatsApp deep links cannot be confirmed as delivered,
-- so 'sent' is only ever set for channels we actually control (email, SMS).
create table invitation_deliveries (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references invitations(id) on delete cascade,
  channel       delivery_channel not null,
  state         delivery_state not null default 'not_sent',
  by_user_id    uuid references users(id),
  generated_at  timestamptz,
  sent_at       timestamptz,
  opened_at     timestamptz
);

create index on invitation_deliveries (invitation_id);

-- ---------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------

-- Ushers are assigned per leg, not per event. Someone can work the Lagos
-- leg without ever seeing the Abuja guest list.
create table staff_assignments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  leg_id         uuid not null references event_legs(id) on delete cascade,
  entrance_id    uuid references entrances(id) on delete set null,
  can_walk_in    boolean not null default false,
  can_manual     boolean not null default true,
  can_override   boolean not null default false,  -- admit despite RSVP block
  -- readiness check 8: has this person ever actually opened the scanner?
  last_tested_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, leg_id)
);

create index on staff_assignments (leg_id);

-- ---------------------------------------------------------------------
-- the check-in log  —  APPEND ONLY
-- ---------------------------------------------------------------------

create table check_in_events (
  id            uuid primary key default gen_random_uuid(),

  -- Generated on the device before the scan is sent. The server treats a
  -- repeat as the same event and returns the existing row. Without this, a
  -- flaky connection double-admits a household.
  client_uuid   uuid not null unique,

  event_id      uuid not null references events(id) on delete cascade,
  leg_id        uuid not null references event_legs(id) on delete cascade,
  entrance_id   uuid references entrances(id) on delete set null,
  pass_id       uuid references passes(id) on delete set null,       -- null when not_found / invalid
  invitation_id uuid references invitations(id) on delete set null,
  staff_user_id uuid not null references users(id),
  device_id     text,

  result        checkin_result not null,

  -- Counts against the household's allowance for this leg.
  -- Zero for every refusal. Negative on a reversal row.
  admitted_count int not null default 0,

  -- Who is physically inside. Same as admitted_count today; check-out will
  -- write negative values here without touching allowance arithmetic.
  occupancy_delta int not null default 0,

  -- Corrections never delete. They point at the row they undo.
  reverses_check_in_id uuid references check_in_events(id),

  scanned_at    timestamptz not null,           -- device clock, may be wrong
  recorded_at   timestamptz not null default now(),  -- server clock, authoritative
  synced_at     timestamptz,                    -- null while queued offline
  note          text
);

-- The hot path: how many of this household have come in at this leg
create index on check_in_events (pass_id, leg_id);
-- Live feed and reports
create index on check_in_events (event_id, recorded_at desc);
create index on check_in_events (leg_id, entrance_id, recorded_at desc);
-- Reversal lookups
create index on check_in_events (reverses_check_in_id) where reverses_check_in_id is not null;

-- Nothing is ever updated or deleted here. Enforce it with a TRIGGER, not a
-- RULE: Postgres refuses ON CONFLICT on any table carrying an INSERT or
-- UPDATE rule, and idempotent replay of an offline queue is exactly an
-- upsert. A trigger also fails loudly instead of silently swallowing the
-- write, which is what a rule doing "instead nothing" would have done.
create or replace function check_in_append_only() returns trigger
language plpgsql as $$
begin
  raise exception
    'check_in_events is append-only (attempted %). Write a reversal row instead.',
    tg_op;
end $$;

create trigger check_in_no_change
  before update or delete on check_in_events
  for each row execute function check_in_append_only();

-- ---------------------------------------------------------------------
-- money
-- ---------------------------------------------------------------------

create table payments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id),
  event_id      uuid references events(id) on delete set null,
  provider      text not null,                  -- 'paystack' | 'flutterwave'
  provider_ref  text not null,
  plan          plan_code not null,
  amount_minor  bigint not null,                -- kobo. never a float.
  currency      char(3) not null default 'NGN',
  status        payment_status not null default 'pending',
  created_at    timestamptz not null default now(),
  paid_at       timestamptz,
  unique (provider, provider_ref)
);

create index on payments (workspace_id, created_at desc);

-- =====================================================================
--  DERIVED STATE  —  never stored, always computed
-- =====================================================================

-- How many of a household have been admitted at a given leg.
create or replace function admitted_so_far(p_pass_id uuid, p_leg_id uuid)
returns int language sql stable as $$
  select coalesce(sum(admitted_count), 0)::int
  from check_in_events
  where pass_id = p_pass_id
    and leg_id  = p_leg_id
    and result in ('admitted','partial','manual','overflow_admitted',
                   're_entry','reversal');
$$;

-- What the scanner needs on a scan, in one query.
create or replace function pass_state(p_pass_id uuid, p_leg_id uuid)
returns table (
  invitation_id uuid,
  display_name  text,
  category      text,
  table_name    text,
  allowance     int,
  admitted      int,
  remaining     int,
  rsvp          rsvp_status,
  pass_status   pass_status
) language sql stable as $$
  select
    i.id, i.display_name, gc.name, st.name,
    il.allowance,
    admitted_so_far(p.id, p_leg_id),
    greatest(0, il.allowance - admitted_so_far(p.id, p_leg_id)),
    il.rsvp,
    p.status
  from passes p
  join invitations i      on i.id = p.invitation_id
  join invitation_legs il on il.invitation_id = i.id and il.leg_id = p_leg_id
  left join guest_categories gc on gc.id = i.category_id
  left join seating_tables  st on st.id = il.table_id
  where p.id = p_pass_id;
$$;

-- Billing count. A household invited for 6 at one leg and 2 at another is
-- SIX people being managed, not eight — they are largely the same humans.
-- Charge on the largest allowance any leg grants them.
create or replace function billable_people(p_event_id uuid)
returns int language sql stable as $$
  select coalesce(sum(mx), 0)::int from (
    select max(il.allowance) as mx
    from invitations i
    join invitation_legs il on il.invitation_id = i.id
    where i.event_id = p_event_id
    group by i.id
  ) s;
$$;

-- Live attendance for a leg.
create or replace view leg_attendance as
select
  l.id   as leg_id,
  l.event_id,
  count(distinct il.invitation_id)                              as invitations,
  coalesce(sum(il.allowance), 0)                                as invited_people,
  -- 'partial' means "three of our four are coming" — those three are promised
  -- people and belong in the caterer's number. Filtering to 'attending' alone
  -- quietly lost 55 of 427 on the test data.
  coalesce(sum(il.rsvp_count) filter (where il.rsvp in ('attending','partial')), 0) as confirmed_people,
  coalesce((
    select sum(c.admitted_count) from check_in_events c
    where c.leg_id = l.id
      and c.result in ('admitted','partial','manual','overflow_admitted','reversal')
  ), 0) as arrived_people,
  coalesce((
    select count(*) from check_in_events c
    where c.leg_id = l.id and c.result = 'overflow_admitted'
  ), 0) as overflow_parties
from event_legs l
left join invitation_legs il on il.leg_id = l.id
group by l.id, l.event_id;

-- =====================================================================
--  NOTES FOR IMPLEMENTATION
-- =====================================================================
--
--  BILLING GATE
--    A pass counts against people_limit when its invitation is first sent
--    or opened — not when the row is created. Importing is always free.
--    Walk-ins are admitted even when they push the event past the limit;
--    flag the overage, invoice afterwards, never block the gate.
--
--  OFFLINE
--    A scanner device downloads, per leg it is assigned to:
--      · the event signing_key and token_version
--      · every invitation_leg row for that leg (name, allowance, table,
--        rsvp, category)
--      · revoked pass ids
--      · check_in_events for that leg, to seed local admitted counts
--    Scans queue locally with a client_uuid and replay on reconnect.
--
--  TWO DEVICES, ONE PASS, BOTH OFFLINE
--    Both admit, both rows land on sync, the sum exceeds allowance.
--    Do not retroactively deny anyone — the people are already inside.
--    Flag the event for the organiser and move on.
--
--  ROW LEVEL SECURITY
--    Enable RLS on every table before launch. Ushers must reach only the
--    legs in their staff_assignments, and must never be able to select
--    invitations.primary_phone or primary_email.
--
--  SEEDING
--    Creating an event must create exactly one event_leg in the same
--    transaction. Code may assume a leg always exists.
-- =====================================================================
