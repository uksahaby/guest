-- 004 · Payments.
--
-- Two rules from HANDOFF §3 shape this:
--
--   "Webhook-driven; never trust a client callback."
--   "amount_minor bigint — kobo. never a float."
--
-- A provider webhook arrives with no session, so it cannot run as app_rw
-- (whose policies are keyed on app_user_id()). It gets its own role,
-- app_billing, which can reach payments and the three billing columns of
-- events — and only for events that actually have a payment row.

-- What was quoted at checkout, recorded on the row so the webhook applies
-- exactly what the customer was shown rather than recomputing a price.
alter table payments add column if not exists people_limit int;

-- Paystack's own reference is the idempotency key; ours is generated at
-- checkout so a webhook can find the row before the provider replies.
create index if not exists payments_event_status_idx
  on payments (event_id, status);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_billing') then
    create role app_billing login password 'app_billing_dev_only';
  end if;
end $$;

grant usage on schema public to app_billing;

-- Billing is the owner's business, but anyone who can already reshape the
-- event may also pay for it — a planner shouldn't have to hand the phone
-- back to the couple to press one button.
drop policy if exists pay_own on payments;
create policy pay_manage on payments for all to app_rw
  using (app_manages_workspace(workspace_id))
  with check (app_manages_workspace(workspace_id));

grant select, insert, update on payments to app_billing;
create policy pay_billing on payments for all to app_billing
  using (true) with check (true);

grant select (id, workspace_id, plan, people_limit, paid_at) on events to app_billing;
grant update (plan, people_limit, paid_at) on events to app_billing;
-- Narrow on purpose: the webhook may only touch an event that someone
-- started paying for.
create policy ev_billing on events for select to app_billing
  using (exists (select 1 from payments p where p.event_id = events.id));
-- Deliberately "has a payment row" rather than "has a PENDING payment row".
-- Applying a charge marks the payment successful and updates the event in
-- one transaction, so a pending-only predicate would depend on which
-- statement ran first and would silently match zero rows. A security
-- policy must not be that fragile.
create policy ev_billing_apply on events for update to app_billing
  using (exists (select 1 from payments p where p.event_id = events.id))
  with check (true);
