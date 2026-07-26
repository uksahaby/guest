-- 008 · A cancelled event refuses at the gate.
--
-- Settings has always promised two things when an organiser calls an event
-- off: guests see a notice, and passes stop opening the gate. Neither
-- happened. decide() now returns 'event_cancelled', so the log needs a
-- value to store it under.
--
-- Refusing here does not contradict "never block a real person at a gate
-- over billing" (HANDOFF §3). That rule is about money. This is the
-- organiser deliberately calling the event off, and it is reversible —
-- setting the event back to active restores every pass, because nothing
-- was reissued and no token version moved.

alter type checkin_result add value if not exists 'event_cancelled';

-- Both readers need the column now, and grants on events are per-column
-- (003_rls.sql): app_public renders the guest's notice, app_usher carries
-- the flag into the scanner's offline payload. Without these the queries
-- fail with "permission denied for column status" rather than anything
-- that points at the cause.
grant select (status) on events to app_public, app_usher;
