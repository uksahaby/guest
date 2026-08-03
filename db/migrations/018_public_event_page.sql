-- The public event page: /e/<slug>.
--
-- Migration 017 gave the settings screen a public_page switch and a slug.
-- This is what makes that link resolve.
--
-- Every app_public policy until now has been keyed on app_pass_invitation()
-- — a household holding a verified pass, seeing only its own row. A public
-- page has no pass, so it needs a policy of a different shape: readable by
-- anyone, but only for events whose organiser has explicitly said so.
--
-- What that must NOT open is the guest list. These two policies cover
-- events and event_legs and nothing else, so a public reader gets the
-- date, the venue and the organiser's own description. invitations,
-- invitation_legs, passes and seating_tables keep their pass-keyed
-- policies untouched, which is what stops /e/<slug> from ever becoming a
-- way to enumerate who was invited.

create policy ev_public_page on events for select to app_public
  using (public_page and status = 'active');

create policy leg_public_page on event_legs for select to app_public
  using (exists (
    select 1 from events e
    where e.id = event_legs.event_id
      and e.public_page
      and e.status = 'active'
  ));

-- events has column-level SELECT grants, so the public page's columns have
-- to be named for app_public even though a policy now allows the rows.
-- 017 granted end_date, timezone and public_page; the rest were granted in
-- 003 (id, name, description) or are new to this page.
grant select (event_type, tags, slug, cover, cover_mime, status)
  on events to app_public;

-- event_legs is granted table-wide to app_public in 003_rls.sql, so the
-- venue and time columns need nothing here. Verified, not assumed.
