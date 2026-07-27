# Deploying

Target from HANDOFF §3: **Vercel** for `apps/web`, **Railway or Fly** for
`apps/api`, EU region, managed Postgres 17.

Nothing here has been run against a real host yet. What *has* been checked
is that the API boots under `NODE_ENV=production` with the full env below,
binds every interface, answers `/health`, logs JSON with phone numbers
redacted, and hides the dev-only routes.

---

## 1. What only a human can do

None of this can be done from a terminal here — each needs an account, a
card, or a decision:

- **A Postgres 17 instance** (Railway, Fly, Neon, Supabase). EU region.
- **A Railway or Fly account** for the API, and a **Vercel account** for
  the web app.
- **Paystack test keys** — a Paystack business account. Test keys are
  enough for staging; `sk_test_…` never moves real money.
- **A Termii account, funded, with a sender ID.** Needed before anyone
  outside the team can sign in. To stand the infrastructure up first, set
  `ALLOW_SMS_LOG_SENDER=true` and read login codes out of the API log —
  then remove it once the Termii key is in place.
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
| `TERMII_API_KEY` | yes* | Without it the API **refuses to boot**: a deploy that forgot it would look healthy while nobody could sign in. See `ALLOW_SMS_LOG_SENDER` to stand a box up before the Termii account exists. |
| `PAYSTACK_SECRET_KEY` | yes | `sk_test_…` for staging. Without it checkout tries the offline stub, which refuses to exist in production. |
| `WEB_URL` | yes | Public URL of the web app; builds guest invitation links. |
| `SMS_SENDER_ID` | no | Default `N-Alert` (Termii's pre-approved, DND-capable). |
| `SMS_CHANNEL` | no | Leave as `dnd`. |
| `PORT` / `HOST` | no | Platform sets `PORT`; `HOST` defaults to `0.0.0.0` in production. |
| `LOG_LEVEL` | no | Default `info`. |
| `ALLOW_SMS_LOG_SENDER` | no | `true` lets the box boot with no SMS provider. Login codes go to the **log** instead of a phone, in clear text, and it warns loudly at startup. Staging only — and it does *not* put codes back in HTTP responses. |

### Web

| Variable | Required | Notes |
|---|---|---|
| `API_URL` | yes | Internal URL of the API. The browser never calls it — every request is server-side. |

## 5. Order

If you are bringing infrastructure up before the Termii account exists,
set `ALLOW_SMS_LOG_SENDER=true` for steps 3–6 and sign in by reading the
API log. Codes never appear in a response either way. Remove it as soon as
`TERMII_API_KEY` is set — a staging box anyone can reach whose logs contain
live login codes is a real account takeover, not a theoretical one.

1. Create the database, load `spec/schema-v1.sql`, run the migrations.
2. Change the five role passwords, build the role URLs.
3. Deploy the API with the env above. Check `/health` returns `{"ok":true}`.
4. Deploy the web app with `API_URL` pointing at it.
5. Set `WEB_URL` on the API to the web app's public URL and redeploy.
6. Point the Paystack **test** webhook at `POST /webhooks/paystack`.
7. Sign in with a real Nigerian number and watch the code arrive. That is
   the first real proof SMS works — see STATE.md §4.1.

## 6. Not done

Named so nobody assumes otherwise: **no backups, no error monitoring, no
uptime checks, no rate limiting on the public endpoints, no staging seed
data.** CI (`.github/workflows/ci.yml`) runs the three test suites but does
not deploy anything.
