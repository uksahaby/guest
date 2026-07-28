-- 010 · A way back in that needs no SMS and no email.
--
-- Turning SMS off removed the only self-service recovery this system had.
-- No code to text, no email channel built, and a founder running a script
-- against the database is support, not recovery.
--
-- So: a recovery code, generated when the account is created and shown
-- exactly once. The same shape as the usher invite links — a long random
-- secret, stored only as a hash, single use, and rotated the moment it is
-- spent. Nothing to pay for and nobody to depend on.
--
-- The obvious failure is someone losing the code as well as the password.
-- That is what scripts/reset-password.ts is for, and it is deliberately
-- not reachable over HTTP.

alter table users add column if not exists recovery_code_hash text;

comment on column users.recovery_code_hash is
  'sha256(code || jwt secret). Single use; rotated whenever it is spent.';
