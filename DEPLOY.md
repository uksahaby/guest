# Deploying

Target from HANDOFF §3: **Vercel** for `apps/web`, **Railway or Fly** for
`apps/api`, EU region, managed Postgres 17.

Nothing here has been run against a real host yet. What *has* been checked
is that the API boots under `NODE_ENV=production` with the full env below,
binds every interface, answers `/health`, logs JSON with phone numbers
redacted, and hides the dev-only routes.

**No messaging provider is required.** Organisers sign up with a phone
number and a password; ushers arrive by an invite link sent over WhatsApp.
Guest invitations were always WhatsApp deep links. SMS is optional.

---

## 1. What only a human can do

None of this can be done from a terminal here — each needs an account, a
card, or a decision:

- **A Postgres 17 instance** (Railway, Fly, Neon, Supabase). EU region.
- **A Railway or Fly account** for the API, and a **Vercel account** for
  the web app.
- **Paystack test keys** — a Paystack business account. Test keys are
  enough for staging; `sk_test_…` never moves real money.
- ~~A Termii account~~ — **no longer needed to deploy or to use the
  system.** Organisers sign up and sign in with a phone number and a
  password, and recover with a code; ushers arrive by an invite link the
  organiser shares over WhatsApp. Set `ALLOW_SMS_LOG_SENDER=true` and leave
  `TERMII_API_KEY` unset to run with no messaging provider at all.
- **A domain**, if staging should have a real name. `WEB_URL` is used to
  build the invitation links guests receive, so it wants to be the URL
  people will actually open.

## 2. Database roles

RLS is load-bearing (`db/migrations/003_rls.sql`): the API connects as one
of five unprivileged roles, never the superuser, because **a superuser
bypasses every policy in the system**. The migrations create the roles with
the dev passwords that are checked into the repo.

Change them before anything real:

```sql
alter role app_rw      with password '…';
alter role app_usher   with password '…';
alter role app_public  with password '…';
alter role app_verify  with password '…';
alter role app_billing with password '…';
```

Then give each role its own `DATABASE_URL_APP_*`. The API **refuses to
start** in production if any is missing, rather than quietly falling back
to the published dev passwords.

## 3. Migrations

Run as a release step, not on boot — the runner needs the superuser URL,
which the running app must never hold, and a container migrating on boot
races itself as soon as there is more than one instance.

```bash
psql "$SUPERUSER_URL" -v ON_ERROR_STOP=1 -f spec/schema-v1.sql   # once, new database only
DATABASE_URL="$SUPERUSER_URL" npm run migrate --workspace api
```

- `--status` lists applied and outstanding.
- `--baseline` records every migration as applied *without running it*,
  for a database already migrated by the old psql loop.
- Each file runs in its own transaction, and its checksum is stored.
  Editing a migration that has already run is an error — write a new one.

## 4. Environment

### API

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Superuser. Migrations only — the app itself uses the role URLs below. |
| `DATABASE_URL_APP_RW` | yes | Organiser + auth. |
| `DATABASE_URL_APP_USHER` | yes | Scanner. |
| `DATABASE_URL_APP_PUBLIC` | yes | Guest pages. |
| `DATABASE_URL_APP_VERIFY` | yes | Signing keys, nothing else. |
| `DATABASE_URL_APP_BILLING` | yes | Webhook path. |
| `JWT_SECRET` | yes | Strong and unique. Rotating it signs everyone out. |
| `TERMII_API_KEY` | no | Only for OTP login, which is now one option among three. Without it the API refuses to boot *unless* `ALLOW_SMS_LOG_SENDER=true` — that guard predates password sign-in and still catches a deploy that meant to have SMS. |
| `PAYSTACK_SECRET_KEY` | yes | `sk_test_…` for staging. Without it checkout tries the offline stub, which refuses to exist in production. |
| `WEB_URL` | yes | Public URL of the web app; builds guest invitation links. |
| `SMS_SENDER_ID` | no | Default `N-Alert` (Termii's pre-approved, DND-capable). |
| `SMS_CHANNEL` | no | Leave as `dnd`. |
| `PORT` / `HOST` | no | Platform sets `PORT`; `HOST` defaults to `0.0.0.0` in production. |
| `LOG_LEVEL` | no | Default `info`. |
| `ALLOW_SMS_LOG_SENDER` | no | `true` lets the box boot with no SMS provider — now the ordinary case. Any OTP codes go to the **log** rather than a phone; nothing else depends on it. It does *not* put codes back in HTTP responses. |
| `TRUST_PROXY` | **yes, in practice** | Who may tell the API the caller's real address. Read §6 before choosing a value — left unset, every per-IP rate limit collapses into one shared bucket. |

### Web

| Variable | Required | Notes |
|---|---|---|
| `API_URL` | yes | Internal URL of the API. The browser never calls it — every request is server-side. |

## 5. Order

Set `ALLOW_SMS_LOG_SENDER=true` and skip Termii entirely unless you
actually want OTP login. If you add a key later, drop the flag — a box
anyone can reach whose logs contain live login codes is a real account
takeover, not a theoretical one.

1. Create the database, load `spec/schema-v1.sql`, run the migrations.
2. Change the five role passwords, build the role URLs.
3. Deploy the API with the env above. Check `/health` returns `{"ok":true}`.
4. Deploy the web app with `API_URL` pointing at it.
5. Set `WEB_URL` on the API to the web app's public URL and redeploy.
6. Point the Paystack **test** webhook at `POST /webhooks/paystack`.
7. Create the first organiser account at `/signup` — phone and password,
   no SMS. **Write down the recovery code it shows you**; it is displayed
   once and cannot be looked up. Then add an usher on the event's Team page
   and send them their sign-in link over WhatsApp.

If someone loses both password and recovery code, the way back in is
`npx tsx scripts/reset-password.ts +234…` from a machine with the
superuser `DATABASE_URL`. It is not an API endpoint on purpose.

## 6. Rate limiting and `TRUST_PROXY`

The unauthenticated endpoints — signup, password login, recovery, OTP, the
staff-invite link and the guest invitation pages — are throttled. The
policy and the reasoning behind every number live in
`apps/api/src/ratelimit.ts`; three things matter at deploy time.

**Set `TRUST_PROXY`, or the limits are worse than none.** Nothing reaches
the API directly: the platform's router is in front of it, and the web app
makes every guest-facing call server-side. Unset, `req.ip` is that router
or that web app for *every* request, so all traffic shares one bucket and
the first burst locks out the whole internet — including the couple.

| Value | Use when |
|---|---|
| `10.0.0.0/8` (or whatever the platform documents) | Best. Only these addresses may set `X-Forwarded-For`. |
| `2` | Believe the last two hops — router, then the web app. |
| `true` | Believe the whole chain. Fine when the API is reachable only through the router; anything that can reach it directly can then forge its own address. |

**The counting is deliberately lopsided.** Per-phone limits are tight
(10 failed sign-ins per 15 minutes, 5 recovery attempts per hour) and
per-IP limits are generous. That is not a compromise, it is the local
reality: Nigerian carriers put whole cities behind a handful of NAT
addresses, so an IP is not a person and a limit tight enough to stop an
attacker would lock out a neighbourhood on event morning. Login and
recovery count *failures* only, and a success clears the count.

**Limits live in memory, so they are per process.** At one API instance
they are exact. Behind a load balancer each instance allows the full
budget — the per-phone limits degrade to N× attempts, not to none. Revisit
if the API is ever scaled out; a Postgres counter was rejected because it
puts a transatlantic write in front of every request.

Nothing at the gate is throttled. An usher scanning fast is the system
working, and the check-in path never refuses over volume.

## 7. Not done

Named so nobody assumes otherwise: **no backups, no error monitoring, no
uptime checks, no staging seed data.** CI (`.github/workflows/ci.yml`) runs
the three test suites but does not deploy anything.
