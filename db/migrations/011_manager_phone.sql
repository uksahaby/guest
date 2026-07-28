-- 011 · Somebody for an usher to call.
--
-- "Call manager" has been on every hold and every refusal decide() returns
-- since the scanner was built, and it has always dismissed without doing
-- anything. An usher facing a guest they cannot admit has no way to
-- escalate except finding the couple themselves, at their own wedding.
--
-- The number belongs on the event rather than being the account owner's:
-- the person who should pick up is usually the planner or the chief usher,
-- not whoever created the account. It is one number per event on purpose —
-- a list of contacts is a thing to maintain, and at a gate you want the
-- one you ring.

alter table events add column if not exists manager_phone text;

comment on column events.manager_phone is
  'Who an usher calls when a guest cannot be admitted. E.164. Optional.';

-- Grants on events are per-column (003_rls.sql), so a new column is
-- invisible to every role until it is named here — including app_rw, which
-- the organiser's own settings page reads through. Missing it fails with
-- "permission denied for table events" and nothing pointing at the column.
--
-- Not app_public: a guest has no business with the number.
grant select (manager_phone) on events to app_rw, app_usher;
