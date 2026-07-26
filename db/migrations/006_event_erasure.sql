-- 006 · Deleting an event, without giving up the append-only log.
--
-- Two promises collide here.
--
--   schema-v1.sql: check_in_events is append-only, enforced by a trigger
--   that fails loudly. "Corrections never delete."
--
--   The public FAQ: "Your data stays yours and you can delete it whenever
--   you like." The settings mockup offers "Delete this event — removes
--   186 invitations, 512 passes and the full check-in history."
--
-- As written, the second was impossible: events cascades into
-- check_in_events, the trigger aborts the cascade, and deleting any event
-- that had ever seen a scan failed with "append-only".
--
-- The resolution is to keep the guarantee where it matters and open
-- exactly one door. A delete is permitted only while the transaction has
-- named the event it is erasing, so:
--
--   · a single embarrassing scan still cannot be removed
--   · an UPDATE is still refused outright, always
--   · erasure is whole-event, deliberate, and visible in the code path
--     that sets the flag
--
-- This is a consistency guard, not a security boundary: app_rw is our own
-- API role and could set the flag itself. RLS already decides WHICH events
-- it can reach; this decides that erasing one is never something that
-- happens by accident or as a side effect of some other statement.

create or replace function check_in_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and nullif(current_setting('app.erasing_event', true), '') = old.event_id::text
  then
    return old;
  end if;

  raise exception
    'check_in_events is append-only (attempted %). Write a reversal row instead.',
    tg_op;
end $$;

-- Erasure also needs the privilege to erase. Until now app_rw could only
-- ever add to these tables, which is right for every other code path — so
-- the grants come with the door, not before it.
--
-- The FOR ALL policies on events, passes and invitation_deliveries already
-- scope deletes to events the caller manages; check_in_events had only
-- read and insert policies, so it gets an explicit one.

grant delete on events to app_rw;
grant delete on passes to app_rw;
grant delete on invitation_deliveries to app_rw;
grant delete on check_in_events to app_rw;

drop policy if exists ci_manage_erase on check_in_events;
create policy ci_manage_erase on check_in_events for delete to app_rw
  using (app_manages_event(event_id));
