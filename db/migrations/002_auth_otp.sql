-- 002 · OTP login codes.
-- schema-v1.sql (the handoff artifact, applied first) is domain-only; auth
-- storage arrives as a migration. Codes are stored hashed — a database read
-- must never yield a usable login code.

create table if not exists auth_otp_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,                 -- E.164, same shape as users.phone
  code_hash   text not null,                 -- sha256(phone || code || secret)
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists auth_otp_codes_phone_idx
  on auth_otp_codes (phone, created_at desc);
