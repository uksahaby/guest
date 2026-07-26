-- 007 · Let the API delete an OTP code row.
--
-- When SMS delivery fails we roll the code back rather than leave it
-- standing (auth.ts). Marking it consumed is not enough: the resend
-- rate-limit reads the newest row for the phone regardless of consumed_at,
-- so a consumed row would lock the user out of retrying for 30 seconds
-- over a failure that was ours. The row has to go.
--
-- Codes are hashed and short-lived, and only app_rw holds any grant on
-- this table at all (003_rls.sql), so nothing is weakened by allowing it.

grant delete on auth_otp_codes to app_rw;
