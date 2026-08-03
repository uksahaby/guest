# Deploying

Target: **Vercel** for `apps/web`, **Render** for `apps/api`, **Neon** for
Postgres 17.

Deployed as a plain Node service, not a container. `apps/api` runs
TypeScript directly under `tsx` — there is no build step, no native module
and nothing to compile, so a container bought nothing that the settings
below do not. There was a `Dockerfile`; it was deleted rather than left to
rot, since a build recipe nobody runs is a build recipe nobody keeps
correct. `git log -- apps/api/Dockerfile` has it if a container is ever
wanted again.

Two things the host has to get right, and they pull in opposite
directions from the web app's settings:

| Setting | Value | Why |
|---|---|---|
| Root Directory | repo root — **not** `apps/api` | `apps/api` imports `checkin-core` through the npm workspace. Rooted at `apps/api`, the install cannot see it. |
| Build Command | `npm ci --workspace api --include-workspace-root` | Installs the API and the workspace root together. |
| Start Command | `npm run start --workspace api` | |
| `NODE_VERSION` | `22` | |

**`tsx` is a runtime dependency, not a dev one** — production runs
TypeScript directly, so `npm ci` under `NODE_ENV=production` must still
install it. It sits in `dependencies` for exactly that reason. The old
Dockerfile only ever survived this by accident of ordering — it installed
before it set `NODE_ENV` — which is why the problem stayed hidden until
the first deploy that was not a container. Moving `tsx` back to
`devDependencies` breaks startup with `tsx: not found`, and no test
catches it, because every test runs somewhere dev dependencies exist.

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

- **A Postgres 17 instance** — Neon, done. Note it sits in `us-east-1`,
  not the EU region originally planned; cheap to move while it is empty
  and expensive afterwards.
- **A Render account** for the API, and a **Vercel account** for the web
  app. Both done.
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
| `ERROR_WEBHOOK_URL` | no | Where to shout when something breaks. Any URL that accepts a POST. Unset, the only record is the log. See §8. |
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

## 7. Backups

```bash
npm run backup --workspace api                  # write and verify a dump
npm run backup --workspace api -- --list FILE   # what is inside one
npm run backup --workspace api -- --prune 30    # delete dumps over 30 days
```

Reads `SUPERUSER_URL`, falling back to `DATABASE_URL`, from `apps/api/.env`.
Writes to `backups/`, which is gitignored — a dump is every guest's name and
phone number in one file and must never reach a repository. Set `BACKUP_DIR`
to put it somewhere else.

**This does not replace Neon's point-in-time restore, and PITR does not
replace this.** PITR covers the likely accident — a bad migration, a DELETE
without a WHERE — and covers none of the unlikely ones: a suspended account,
a deleted project, a lapsed card. A dump on a disk you control covers those
and nothing else does. Check the history retention window in the Neon
console; on the free plan it is short.

The irreplaceable table is `check_in_events`. A guest list can be rebuilt
from the organiser's own spreadsheet. Who actually walked through the gate
exists here and nowhere else.

### Restoring

**Create the five roles before restoring, or the restore looks fine and
leaves the API unable to read anything.** The dump carries 64 ACL entries
naming `app_rw`, `app_usher`, `app_public`, `app_verify` and `app_billing`.
Restored into a fresh Neon project, where those roles do not exist, every
one of those grants fails — `pg_restore` keeps going and reports a count at
the end that is easy to skim past. The tables come back, the policies come
back, and the application roles have no permissions.

```bash
# 1. Roles first. Lines 33-46 and 501-510 of db/migrations/003_rls.sql,
#    or by hand — they only need to exist, passwords are set in step 3.
psql "$SUPERUSER_URL" -c "create role app_rw login password '...'"      # ×5

# 2. Then the data.
pg_restore --dbname "$SUPERUSER_URL" --no-owner backups/guest-....dump

# 3. Set the real passwords and rebuild the DATABASE_URL_APP_* values.
```

`--no-owner` is deliberate: the dump is taken with it, so the file does not
insist on a `postgres` role that Neon does not have.

### What a restore was verified to bring back

Run on **3 August 2026**, against the real Neon database rather than a
local stand-in: dump Neon → restore into an empty database → compare the
two, side by side.

| | Neon | Restored |
|---|---|---|
| `users` / `events` / `event_legs` | 23 / 3 / 3 | 23 / 3 / 3 |
| `invitations` / `invitation_legs` / `passes` | 3 / 3 / 3 | 3 / 3 / 3 |
| **`check_in_events`** | **9** | **9** |
| RLS policies | 54 | 54 |
| Tables with RLS enabled | 18 | 18 |
| Non-internal triggers | 2 | 2 |
| Functions | 51 | 51 |
| Events with a signing key | 3 | 3 |

The policy count is the one that matters. A restore that returns data
without its policies looks healthy and is wide open. `check_in_events` is
the one that cannot be rebuilt from anything.

Then the behaviour, not just the counts — a `DELETE` on the restored
`check_in_events`:

```
ERROR:  check_in_events is append-only (attempted DELETE).
        Write a reversal row instead.
```

So the guarantee survives the round trip, which is the actual question.

**Expect exactly two ignored errors, and know which two.** Restoring a Neon
dump anywhere that is not Neon ends with `errors ignored on restore: 2`.
Both are Neon's own platform roles, which no other Postgres has:

```
role "neon_superuser" does not exist   (ALTER DEFAULT PRIVILEGES)
role "cloud_admin" does not exist
```

Those are benign. Any *other* error in that count is not, and the five
application roles failing is the one to watch for — see the warning above,
because it is the failure that looks like success.

## 8. Error monitoring

Set `ERROR_WEBHOOK_URL` to any URL that accepts a POST — a Slack or Discord
incoming webhook, an ntfy topic, your own endpoint. Unset, everything still
works and the only record is the log, which on a Saturday morning is nobody.

Deliberately not a service: no account, no SDK, no vendor. If this ever
needs traces, breadcrumbs or release tracking, the answer is Sentry, not a
bigger `errors.ts`.

**Three things it does.**

*Every 500 carries a request id, and the caller sees it.* "Something went
wrong (a3f9c2)" turns an unreproducible complaint into one log search. The
cause never leaves the server, in any environment — no message, no stack.

*A crash takes the process down.* After an unhandled rejection the process
is in a state nobody reasoned about. Render restarts in seconds and the
scanner queues through a restart; nothing recovers from a server quietly
answering wrongly.

*Someone gets told,* if the webhook is set.

**Alerts are rate-limited**: three per distinct fault per 15 minutes, and
20 in total. A crash loop must not bury the alert that mattered, and every
alert is an outbound request — unbounded, our incident becomes theirs.
Faults are told apart by route, error name and the first stack frame in
`src/`, so `/events/abc/guests` and `/events/def/guests` failing the same
way is one fault, not two hundred.

**Alerts are scrubbed** of anything phone-shaped and any connection string
before they leave. The logger redacts by field name, which cannot help when
a number sits inside a message — a Postgres unique violation quotes the
value that collided, and here that value is often somebody's phone number.

Only 5xx alerts. A 400 is not an incident.

## 9. Uptime

`.github/workflows/uptime.yml` asks `/health` every ten minutes from
GitHub's runners — deliberately somewhere else, because a Render outage
would take any watcher hosted on Render down with it.

**To switch it on:** repository **Settings → Secrets and variables →
Actions → Variables**, add `API_HEALTH_URL` =
`https://your-api.onrender.com/health`. Unset, the workflow exits quietly
rather than failing every ten minutes and teaching everyone to ignore it.

Optionally add the secret `UPTIME_WEBHOOK_URL` — the same webhook the API
uses for errors. Without it a failure still reaches you: GitHub emails the
repository owner when a scheduled workflow fails.

**A 200 is not enough.** The check requires `"ok":true` in the body, because
`/health` runs `select 1` as `app_rw`. A process answering with anything
else is a site that looks up and can check nobody in. Verified against a
live API (passes), an unreachable host (fails), and a 200 with the wrong
body (fails).

Three attempts thirty seconds apart before it calls anything down. A single
failure is usually a deploy rolling or a cold start, and an alert that
cries wolf on every deploy is one nobody reads by the wedding.

**The ping also keeps the box awake.** Render's free instance sleeps after
15 minutes idle and takes 30-60 seconds to come back; a ten-minute poll
means that never happens. Worth as much as the monitoring — event morning
is exactly when nobody has warmed it up. It does mean the service runs
around the clock, so watch the free tier's monthly instance hours if you
ever add a second service.

**Two limits worth knowing before the day:**

- GitHub's scheduled workflows are best-effort. Ten minutes is a target,
  not a promise; late runs are normal and busy periods are worse.
- GitHub disables schedules on a repository with 60 days of no commits.

For a real wedding, add an external monitor as well — UptimeRobot's free
tier polls far more often and its whole business is being reliable at it.
This workflow is the version that needs no account and is genuinely better
than nothing, which is what was here before.

## 10. Not done

Named so nobody assumes otherwise: **no staging seed data, and the backup
is manual** — nothing runs it on a schedule, so it protects you exactly as
often as someone remembers. CI (`.github/workflows/ci.yml`) runs the three
test suites but does not deploy anything.
