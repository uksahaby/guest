-- Profile photos and event covers.
--
-- Stored in Postgres as bytes rather than in object storage. That is the
-- unfashionable choice and the right one here: the alternative is a fourth
-- vendor account, a fourth set of credentials, and a bucket whose public
-- ACL is one careless click away from listing every guest photo an
-- organiser has uploaded. These images are small, few — one per organiser,
-- one per event — and they are already backed up by the thing that backs
-- up everything else.
--
-- Revisit if events ever carry galleries. A wedding album does not belong
-- in a row.

alter table users
  add column if not exists avatar      bytea,
  add column if not exists avatar_mime text;

alter table events
  add column if not exists cover      bytea,
  add column if not exists cover_mime text;

comment on column users.avatar is
  'Profile photo bytes. Null means show initials.';
comment on column events.cover is
  'Event cover bytes. cover_image_url still works for an external URL.';

-- events is the one table with COLUMN-level SELECT grants, so a new column
-- is invisible to the app roles until it is named. Checked against
-- 003_rls.sql rather than assumed: forgetting this is how a feature works
-- locally as the superuser and then 42501s in production.
--
-- Only SELECT is needed. app_rw already holds `grant insert, update on
-- events`, which is table-level and covers columns added later; app_public
-- must never write an event at all.
grant select (cover, cover_mime) on events to app_rw;
grant select (cover, cover_mime) on events to app_public;

-- users is table-level throughout (`grant select, insert, update on users
-- to app_rw`), so avatar needs nothing. app_usher sees only (id,
-- full_name) and is deliberately left that way — an usher has no reason to
-- pull photos of the organisers.
