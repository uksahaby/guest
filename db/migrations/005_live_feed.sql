-- 005 · Live check-in feed.
--
-- "Live dashboard: SSE over Postgres LISTEN/NOTIFY. One-way updates.
--  WebSockets are more than this needs." (stack-recommendation §4)
--
-- The notification carries ids only, for two reasons: pg_notify has an
-- 8000-byte payload ceiling, and a guest's name has no business travelling
-- through a channel every connection in the cluster can hear. The stream
-- looks the row up afterwards, under the caller's own RLS context.
--
-- AFTER INSERT is deliberate, and NOTIFY is transactional: subscribers are
-- woken on COMMIT, so the feed can never show an arrival that was rolled
-- back. This is the same reason the scanner's sync is safe to replay.

create or replace function notify_check_in() returns trigger
language plpgsql as $$
begin
  perform pg_notify(
    'check_in',
    json_build_object('leg_id', new.leg_id, 'id', new.id)::text
  );
  return null;
end $$;

drop trigger if exists check_in_notify on check_in_events;
create trigger check_in_notify
  after insert on check_in_events
  for each row execute function notify_check_in();

-- The listener connects as app_rw. LISTEN needs no table privileges, and
-- the payload is opaque ids, so this grants nothing on its own.
