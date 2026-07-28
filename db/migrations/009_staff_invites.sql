-- 009 · Sign-in links for ushers, and passwords for organisers.
--
-- Two changes to how people get in, both aimed at the same problem: until
-- today nobody could sign in to a deployed system without a funded SMS
-- account, and SMS delivery in Nigeria fails often enough that an usher
-- standing in a hotel basement at 6pm is a real failure mode.
--
--   Ushers get a one-time link, shared over WhatsApp — which is already how
--   this product delivers everything, and costs nothing. No password to
--   forget, no reset flow, no shared secret. It is the same trust model as
--   a guest pass: the URL *is* the credential, sent to one phone number.
--
--   Organisers get an optional password, because they are recurring users
--   whose account is worth something. OTP stays as the recovery path.
--
-- HANDOFF decision #7 said ushers are OTP-only and never have a password.
-- They still have no password. The founder's call was that they should not
-- need an SMS either.

-- Like auth_otp_codes, this sits outside RLS on purpose: it is read before
-- any session exists, so a policy keyed on app_user_id() would lock out
-- exactly the person it is for. Grants are the protection — only app_rw
-- ever sees it.
create table if not exists staff_invites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  leg_id       uuid not null references event_legs(id) on delete cascade,
  -- sha256(token || jwt secret). A database read must never yield a
  -- usable link, same rule as the OTP codes.
  token_hash   text not null unique,
  created_by   uuid references users(id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists staff_invites_lookup
  on staff_invites (user_id, leg_id, accepted_at);

grant select, insert, update on staff_invites to app_rw;

-- Optional, and only ever set by the account's owner. Null means this
-- account signs in by OTP or by invite link, which is every usher.
alter table users add column if not exists password_hash text;

comment on column users.password_hash is
  'scrypt: N$r$p$salt$hash, all base64. Null = no password set.';
