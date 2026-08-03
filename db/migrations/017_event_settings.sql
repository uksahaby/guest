-- The fields the Event Settings screen asks for and the schema never had.
--
-- Everything here is additive with a default, so an event created before
-- this migration reads exactly as it did: no timezone means Lagos, no
-- tags means none, not public means what every event already was.
--
-- On the two that are policy rather than decoration:
--
--   invitation_only  defaults TRUE because that is what the product has
--                    always done — a pass is the only way in. It exists as
--                    a column so the settings screen can state it as a
--                    setting rather than an unwritten rule.
--   public_page      defaults FALSE for the same reason in reverse. A
--                    guest list is the private part of a wedding; an event
--                    page that anyone can find is opt-in, and the default
--                    must never be the one that leaks.

alter table events
  add column if not exists end_date        date,
  add column if not exists timezone        text not null default 'Africa/Lagos',
  add column if not exists tags            text[] not null default '{}',
  add column if not exists slug            text,
  add column if not exists public_page     boolean not null default false,
  add column if not exists invitation_only boolean not null default true;

-- Partial, so the many events with no custom link do not collide on null.
create unique index if not exists events_slug_key on events (slug)
  where slug is not null;

comment on column events.end_date is
  'Optional closing date for a multi-day celebration. The first leg''s '
  'starts_at is still the event date.';
comment on column events.timezone is
  'IANA zone the organiser thinks in. Times are stored as timestamptz; '
  'this is how to render them, not what they mean.';
comment on column events.slug is
  'Custom part of the shareable event link. Null means the event has no '
  'public link at all.';

alter table event_legs
  add column if not exists all_day boolean not null default false;

comment on column event_legs.all_day is
  'The ceremony runs the whole day; starts_at is still the moment doors '
  'open, but the guest page shows a date rather than a time.';

-- events is the ONE table with column-level SELECT grants, so every column
-- added here is invisible to the app roles until named — including app_rw,
-- which fails as "permission denied for table events" and points nowhere
-- near the cause. This has now bitten migrations 008, 011 and 013.
-- Checked against 003_rls.sql rather than assumed.
--
-- Only SELECT. `grant insert, update on events to app_rw` is table-level
-- and already covers columns added later.
grant select (end_date, timezone, tags, slug, public_page, invitation_only)
  on events to app_rw;

-- The guest page renders the event's own times and needs to know whether
-- it may be shown to someone holding no pass at all.
grant select (end_date, timezone, public_page) on events to app_public;

-- event_legs is granted table-wide (`grant select, insert, update, delete
-- on event_legs to app_rw`; `grant select on event_legs to app_usher,
-- app_public`), so all_day needs no grant. Verified, not assumed.
