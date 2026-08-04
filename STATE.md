# Where this build has got to

Companion to `HANDOFF.md`, which remains the source of truth for *why*
anything is the way it is. This file records *what exists*, what doesn't,
and what will bite whoever picks it up next — including me, later.

Written 26–28 July 2026 · branch `main` · 43 commits · **nothing deployed**.

---

## 1. Run it from cold

```bash
# Postgres 17 running locally, trust auth for the postgres user.
psql -U postgres -h localhost -c "create database guest_dev"
psql -U postgres -h localhost -d guest_dev -f spec/schema-v1.sql

npm install                                   # workspace root
cp apps/api/.env.example apps/api/.env
npm run migrate --workspace api               # applies db/migrations, tracked
npx tsx apps/api/scripts/seed-demo.ts         # prints working guest URLs

npm run start --workspace api                 # :3001
npm run dev   --workspace web                 # :3000
```

**No SMS provider is needed, for anything.** Three ways in:

- **Organisers** create an account at `/signup` with a phone number and a
  password, and get a recovery code shown once. Forgotten password →
  `/recover`. An account that arrived any other way — seeded, or created by
  an organiser, or signed in by OTP — has no recovery code; **Your profile**
  now mints one on demand (`POST /auth/recovery-code`, which existed from
  the start with nothing calling it). Generating replaces any previous
  code, because two live codes are two live keys. Lost both → `npx tsx scripts/reset-password.ts +234…`, which
  is deliberately not an API endpoint.
- **Ushers** never type anything: the organiser hits *Get sign-in link* on
  the Team page and sends it over WhatsApp. One tap lands them on the gate
  in a browser — or they paste the same message into the **scanner app**,
  which pulls the token out of it and spends it the same way. One invite,
  either surface, whichever they open first. The app is the better of the
  two at a real gate: the browser scanner asks the server about every scan,
  while the app verifies offline.
- **OTP** still works and is now just a third door. With `TERMII_API_KEY`
  unset the code is printed on the login page in dev. It is no longer the
  scanner app's primary sign-in — it sits behind *"I have no link"*, since
  SMS costs money per usher and needs a provider the deploy does not have.
- **Signing out** of the app wipes the session *and* the downloaded event:
  guest list, signing keys, cached assignments. Ushers are casual staff and
  phones get shared, so leaving a household list on the handset is the same
  leak as leaving the printed one. It refuses to discard unsynced check-ins
  without an explicit confirmation naming the count.

The seeded accounts are `+2348030000001` (organiser) and `+2348030000002`
(usher).

`.claude/launch.json` defines both servers for the Browser pane.

### On a real Android phone

The API binds loopback, so a USB-attached phone reaches it through adb
rather than the LAN:

```bash
adb reverse tcp:3001 tcp:3001
cd apps/scanner && flutter run --dart-define=API_URL=http://localhost:3001
```

The tunnel dies quietly when the `flutter run` session ends or USB
re-enumerates: `adb reverse --list` still shows it while nothing gets
through. Symptom is every request failing for no visible reason. Re-add it,
and if that does not help, `adb kill-server && adb start-server` — which
re-triggers the "Allow USB debugging?" prompt on the handset.

### Tests

```bash
npm test --workspace api            # 348
npm test --workspace checkin-core   # 40
npm test --workspace web            # 3  (the QR decoder, pinned)
cd apps/scanner && flutter test     # 89
```

Tests rebuild a disposable `guest_test` from `spec/schema-v1.sql` plus every
file in `db/migrations/` on each run (`apps/api/src/testdb.ts`). **Never
point tests at `guest_dev`** — the check-in log is append-only and test rows
could never be cleaned out.

---

## 2. Shape

```
apps/api        Fastify 5 + postgres.js (raw SQL, no ORM)  ~11,900 lines · 285 tests
apps/web        Next.js 16 App Router                        ~8,300 lines · 20 pages
apps/scanner    Flutter 3.44 + drift + mobile_scanner         ~7,500 lines ·  89 tests
packages/checkin-core   the handoff's own state machine                    ·  40 tests
db/migrations   10 migrations layered on spec/schema-v1.sql
spec/           untouched handoff artefacts — schema, OpenAPI, architecture
design/mockups/ untouched; the dashboard copies their tokens by hand
```

Both the web app and the Flutter scanner talk to the **one** backend,
`apps/api`. `spec/openapi-v1.yaml` is the shared contract.

### API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/signup` · `POST /auth/password/login` · `POST /auth/password` · `POST /auth/recovery-code` · `POST /auth/recovery/reset` · `POST /auth/otp/request` · `POST /auth/otp/verify` · `GET/PATCH /me` |
| Usher access | `POST /staff/:id/invite` (organiser) · `POST /public/staff-invites/:token/accept` |
| Events | `GET/POST /events` · `GET/PATCH/DELETE /events/:id` · `GET /events/:id/settings` · `POST /events/:id/reissue-passes` · `PATCH /legs/:id` |
| Public event page | `GET /public/events/:slug` — no pass, no guest list; RLS-gated on `public_page` (018) |
| Guest list | `GET/POST /events/:id/invitations` · `POST /events/:id/invitations/import` · `PUT/DELETE /invitations/:id/legs/:legId` |
| Sending | `POST /events/:id/delivery-links` (wa.me — **the billing gate**) |
| Gates & team | `GET/POST /legs/:id/entrances` · `PATCH/DELETE /entrances/:id` · `GET/POST /legs/:id/staff` · `PATCH/DELETE /staff/:id` |
| Seating | `GET/POST /legs/:id/tables` · `PATCH/DELETE /tables/:id` · `GET /legs/:id/unseated` |
| Gate | `GET /scanner/assignments` · `GET /scanner/legs/:id/bootstrap` · `POST /scanner/legs/:id/test` · `POST /scanner/check-ins` |
| Web scanner | `POST /scanner/legs/:id/scan` (server decides) · `GET /scanner/legs/:id/guests` · `POST /scanner/legs/:id/walk-ins` |
| Live | `GET /legs/:id/attendance` · `GET /legs/:id/live` · `GET /legs/:id/stream` (SSE) |
| Reports | `GET /events/:id/report` (+ `?format=csv`) |
| Money | `GET /events/:id/billing` (plan, usage, **payment history**) · `POST /events/:id/checkout` · `POST /webhooks/paystack` |
| Guest | `GET /public/invitations/:token` · `POST /public/invitations/:token/rsvp` |

### Web pages

**Organiser** `/` marketing · `/signup` · `/login` · `/recover` ·
`/welcome` name yourself · `/welcome/recovery` the code, shown once ·
`/events` · `/events/[id]` countdown home · `…/guests` · `…/guests/import` ·
`…/guests/[invId]/link` · `…/tables` · `…/team` · `…/live` · `…/report`
(+ `/export`) · `…/billing` · `…/settings`

**Usher** `/join/[token]` the invite link · `/scan` gates · `/scan/[legId]`
the web scanner

**Guest** `/i/[token]` invitation and pass

---

## 3. Decisions already made — don't re-litigate

- **A phone number is read the way it is written, everywhere.** `0803…`,
  `803…`, `234803…` and `+234…` all reach the same E.164 row, through one
  implementation in `src/phone.ts` used by sign-in, usher invites and the
  guest importer alike. This **reverses** an earlier decision that demanded
  E.164 at the door (`auth.test.ts`, `team.test.ts` asserted it, commented
  "it's how they sign in, so it must be exact"). The reversal is deliberate:
  the importer already assumed Nigeria for these same formats *and turned
  them into WhatsApp messages to real people*, so refusing them at login was
  the inconsistent half — and it surfaced as "that phone number and password
  don't match", a wrong-password error for a formatting difference, on the
  first screen anybody sees. The known cost is that a non-Nigerian local
  number (`07911…`) becomes a Nigerian one; an international number must be
  written with its `+` and country code, which is the only unambiguous form
  anyway.

- **The billing mockup does not describe this product, and the product
  won.** The Billing & Plans design was drawn around yearly subscriptions
  (₦2,500–₦15,000/year), renewals, per-tier feature gating, saved cards and
  guest credits. None of that is what is sold: one payment per event,
  ₦7,500–₦40,000 priced by people, nothing renews, **every feature on every
  plan**, and the public pricing page already says so to the world. The
  page therefore uses the mockup's layout and the product's substance.
  Reopening this is a pricing decision with revenue attached, not a UI
  change — and it would need `plans.ts`, the marketing page and Paystack
  moved together.


- **The unit is a household.** One row, one allowance, one pass, one QR.
  A seat is a *person*: a household of four fills four seats.
- **Passes are issued at invitation, never at RSVP.** Many guests just turn up.
- **The public URL token IS the HMAC pass token.** Same string as the QR;
  no extra column, and garbage/forged/revoked/stale all return a uniform 404.
- **The paywall is on *sending*, not storing.** Importing 500 people onto a
  150-person plan is deliberate and tested.
- **Nothing at the gate is ever blocked over billing.** Walk-ins and
  overflow are admitted and flagged. A *cancelled* event is the one
  refusal that is not about money: the organiser called it off, the
  settings page promises the guest that passes stop working, and
  `event_cancelled` is checked ahead of the token so an usher hears the
  real reason rather than "not a valid pass". It stays reversible —
  nothing is reissued and no token version moves.
- **`decide()` is never reimplemented.** TS in `packages/checkin-core`,
  ported once to Dart, with a pinned cross-language token vector
  (`apps/scanner/test/token_interop_test.dart`). If those two disagree,
  both are wrong. This is why the **web scanner is a dumb terminal**: it
  posts the raw QR string to `POST /scanner/legs/:id/scan` and renders what
  comes back, rather than becoming a third implementation. The cost is that
  it only works online, which is the honest trade for a fallback aimed at
  staff who turned up having installed nothing.
- **Prices live only in `apps/api/src/plans.ts`.** Checkout names a *plan*,
  never an amount.
- **Only a signed webhook upgrades a plan**, and it re-checks the amount
  against our own quoted row.
- **No feature depends on SMS.** Organisers use a password and a recovery
  code; ushers use a one-time invite link the organiser sends over
  WhatsApp; guest invitations were always WhatsApp deep links. OTP is one
  door among three. The phone number is consequently *unverified* — the
  trade that makes it safe is that a number alone grants nothing: gate
  access needs the link, and an organiser owns only what they create.
  Signup refuses a number that already has an account, so it can never take
  over an usher's password-less record.
- **Nobody sets anybody else's password.** An organiser knowing an usher's
  credential is exactly what the invite links exist to avoid, so there is
  no route that does it. Support recovery is a script with database access,
  never an endpoint.
- **A walk-in becomes a real household**, not a bare log row: an invitation
  flagged `is_walk_in`, an entitlement at that leg, and a pass. That is
  what lets someone who steps out be scanned back in, and what puts them in
  `billable_people` — admit now, flag it, invoice after.
- **`dev_code` is gated on the sender, not on `NODE_ENV`.** `SmsSender`
  carries `echoesCodes`, and only a sender that genuinely delivers nothing
  sets it. A staging box with `NODE_ENV` unset and a real Termii key must
  not hand login codes back over HTTP.
- **Only a transport failure falls back to local data.** `ApiException
  .isTransport` (timeout, unreachable, 5xx) is the single gate on the
  scanner's offline paths. A 403 must always fail hard: it means the usher
  was taken off the leg, and serving a stale local copy would let a removed
  usher keep admitting people.
- **Dashboard CSS is hand-rolled from the mockup tokens**, not shadcn.
  Guest pages ship near-zero client JS; the dashboard may use client
  components freely (the no-JS rule is guest-surface only).

---

## 4. What is NOT done

### Blocks a real wedding

1. **Half deployed.** `DEPLOY.md` is the runbook. `npm run migrate
   --workspace api` applies migrations one transaction at a time with
   checksums and refuses an edited one. The API boots under
   `NODE_ENV=production`, binds `0.0.0.0`, logs JSON with phone numbers
   redacted, and refuses to start on a missing RLS role URL.
   - **Done:** the repo is on GitHub (`uksahaby/guest`). Neon holds the
     schema, ten migrations and five roles with rotated passwords. The web
     app builds and serves on Vercel, root directory `apps/web`. A
     Paystack `sk_test_` key is in hand.
   - **Outstanding:** the API on Render — a plain Node service, no
     container, root directory the repo root so the `checkin-core`
     workspace resolves. Then `API_URL` and `WEB_URL` point the two hosts
     at each other, the Paystack test webhook gets its URL, and the first
     organiser account gets created at `/signup`.
   - No SMS provider is needed for any of it.
   - Rate limiting is now **done** (see §5 and `DEPLOY.md` §6) — but it
     needs `TRUST_PROXY` set on the box or it collapses into one shared
     bucket for the whole internet.
   - **Backups**: `npm run backup --workspace api`. The drill has now been
     run against the **real Neon database** (3 August) rather than a local
     stand-in — dump → restore → compare, with every row count matching
     including the 9 irreplaceable `check_in_events`, plus 54 policies, 18
     RLS tables, 51 functions, and a `DELETE` on the restored log still
     refused by the append-only trigger (`DEPLOY.md` §7).
     - Until this session the documented command **did not work**:
       `backup.ts` never read `apps/api/.env`, so it failed with "set
       SUPERUSER_URL" on a machine whose URL was sitting in that file. Both
       it and `env.ts` now share `src/dotenv.ts`.
     - Two caveats remain, both load-bearing: **nothing runs it on a
       schedule**, and the single dump that exists is on one laptop.
       Neon's own history-retention window has never been looked at. A
       backup that lives on the same disk as nothing else is a rehearsal,
       not a policy.
   - **Error monitoring** exists (`src/errors.ts`, `DEPLOY.md` §8): every
     500 carries a request id the caller can quote, the cause never leaves
     the server, a crash kills the process so Render restarts it, and an
     optional `ERROR_WEBHOOK_URL` tells someone. Alerts are rate-limited
     three per fault per 15 min and scrubbed of anything phone-shaped.
     No vendor, no SDK — if it ever needs traces, that is Sentry's job.
   - **Uptime checks** exist (`.github/workflows/uptime.yml`, `DEPLOY.md`
     §9): GitHub asks `/health` every ten minutes from outside Render, and
     requires `"ok":true` rather than a bare 200 — a process answering
     without its database is a site that looks up and admits nobody. The
     poll also keeps Render's free instance from sleeping, which removes
     the 30-60s cold start on event morning. Needs the repository variable
     `API_HEALTH_URL` set or it does nothing. GitHub's schedules are
     best-effort and stop after 60 days of no commits, so for a real
     wedding add an external monitor too.
   - CI deploys nothing.
   - **Proven offline on real hardware** (Xiaomi, Android 14, against the
     deployed Render + Neon stack, 2026-08-02). Aeroplane mode on, four
     scans accepted with no network at all — verified against signing keys
     already on the phone. Sign-out then counted the four queued rows and
     refused to discard them. Aeroplane mode off, one *Sync now*, and the
     server went from 5 rows to 9: nine distinct `client_uuid`s, so no
     duplicates and the idempotency key held.

     The timestamps are the point. All four were `recorded_at` 00:56:10,
     when signal returned, and each kept its own `scanned_at` — the oldest
     queued for **11 minutes 21 seconds**. Reports read `scanned_at`, so a
     guest admitted at 00:44 is recorded as arriving at 00:44. An offline
     gate does not distort the record it produces.
   - **Rehearsed at wedding size** (`npm run rehearse --workspace api`,
     default 400 households, also run at 1200). Import, RSVPs, the
     organiser's list and report, the scanner bootstrap, a queue of scans,
     and the morning-after report — all against a real database, none of
     it touching the deployed system.

     | | 400 households | 1200 |
     |---|---|---|
     | CSV import | 0.75 s | 2.1 s |
     | Guest list page | 0.10 s | 0.10 s |
     | Report | 0.26 s | 0.64 s |
     | Scanner bootstrap | **84 KB** | **250 KB** |
     | Per scan | 4.9 ms | 4.9 ms |

     The bootstrap size is the one that mattered: it is what a phone
     downloads over Nigerian mobile data before the gate opens, and 250 KB
     for a very large wedding is seconds even on 3G. Scan latency is flat
     in list size, which is the other thing a queue depends on.

     **It found no product bug.** Both failures were the harness's own —
     a scan without `client_uuid` (the API refused it correctly, which is
     the idempotency guard working) and a cartesian join in a counting
     query. Reports reconcile: 92 admitted plus 8 `rsvp_declined` equals
     100 logged rows. Worth saying plainly, because "the rehearsal passed"
     is only worth something if a failure would have been reported too.
2. ~~Payments have never met real Paystack.~~ **Done** (2026-08-02). A
   real test-mode charge against the deployed API: Paystack signed the
   webhook, the signature verified, and the event went `free/150` to
   `standard/600` with a `payments` row marked successful. Forged webhooks
   are refused — unsigned and wrongly-signed both get `401 bad_signature`
   before anything touches the database.

   The plan and limit come from the payment row quoted at checkout, never
   from the webhook payload, so a webhook claiming a bigger plan cannot
   grant one. Untested still: the **amount-mismatch** path, which marks a
   payment failed rather than applying it — reaching it needs a charge
   whose amount differs from the quote, which Paystack's test flow will
   not produce on its own.

   Paystack's test-mode success page did not redirect back to the app.
   Cosmetic: the webhook is the source of truth, which is why the upgrade
   landed while the browser was still sitting on Paystack. `WEB_URL` was
   confirmed correct. Worth re-checking against a live-mode payment before
   deciding it needs anything.
3. ~~No audio at the gate.~~ **Done.** Four generated cues, one per tone,
   told apart by contour rather than pitch — rising for admitted, two flat
   repeats for wait, low and falling for refused. `tool/make_sounds.py`
   regenerates them; the WAVs are committed so a build never needs Python.
   A persisted mute exists for a ceremony, and haptics continue when muted.
   Heard on the device and confirmed working (2026-08-02). Judged in a
   quiet room, not a crowd with a generator — if they ever turn out to be
   too subtle at a real gate, the fix is `tool/make_sounds.py` and a
   rebuild, not new sound files from anywhere.
4. **Event creation is one thin form.** The setup mockup has five steps
   (details, venue, guests & entry, tables, review). Event *settings* is
   now the full eleven-tab screen (3 August); creation is the gap left.
5. **Small scanner gaps found on the device.** A back-press on the scan
   screen drops the usher out of the leg with no confirm, even mid-result;
   the app installs under the label `scanner` (`android:label`, never set);
   and `MobileScanner` has no `errorBuilder`, so an usher who denies the
   camera gets the plugin's bare error box and no route to settings.

### Proven on hardware

A Xiaomi 23106RN0DA, Android 14, arm64, over `adb reverse` — 26–28 July.
Everything below was watched happening, not inferred:

- A **real QR read off a monitor**, with the phone **unplugged**: decoded
  and its HMAC verified against signing keys read from disk, six admitted
  into the offline queue, synced on reconnect. This was the project's
  longest-standing unknown.
- **Offline from a cold start** — app killed, no network: gate list from
  cache, leg opened from cache, guest admitted, queue drained later with
  the gate's own `scanned_at` times preserved.
- **Overflow, undo and reversal pairing**, including two admissions undone
  and netting back to the invited count. Nothing deleted.
- **Walk-ins**, **Recent with undo after the fact**, and **Call manager**
  firing a `tel:` intent that Android offered to Phone/Truecaller/Zoom.
- The **web scanner** end to end in a browser: gate list, search, count
  prompt, manual admission landing as `device_id = 'web'`.
- **Sign-up, password login and recovery-code reset**, with the old
  password dead and the spent code refused.

### Wanted before charging strangers

~~Web scanner fallback~~ (built — `/scan`, online-only by design) · super
admin's three screens · guest-page accessibility and performance pass ·
~~rate limiting on public endpoints~~ (built) · error monitoring (logs are structured now) · PDF report · email as a
delivery channel and as a second recovery path · undo and a recent list in
the *web* scanner (the app has both; the web one has neither) · Paystack
**live** keys (`StubProvider` refuses to run in production).

### Deferred by the handoff itself — not oversights

Multi-leg UI (schema ready; deliberately undesigned until a real customer
runs two ceremonies) · multi-day sessions · re-entry / check-out
(`occupancy_delta` already supports it) · cross-device undo · automated
WhatsApp API sending as a paid add-on · tiers above 2,500.

### Only the founder can do

Brand name and domain · NIPO trademark search (Class 9 **and** 42; CAC
registration does not protect a brand) · positioning call · Paystack
business account · the first real couple.

---

## 5. Things that will bite you

**Restart the API after adding a route.** Hit again on 3 August building
the public event page: `/e/<slug>` 404'd in the browser while the tests
were green, because the running server predated `GET /public/events/:slug`.
Curl the endpoint before debugging the client.

**A form inside a form is dropped silently by the browser.** The settings
mockup puts "Upload Event Image" inside the card that Save Changes
batches, and a file has to post as multipart while the card posts JSON.
Nesting them renders, hydrates with a warning, and then uploads to the
wrong action. The `form="..."` attribute is the fix: the input sits where
the design wants it and belongs to a form rendered as a sibling.

**`req.ip` is a lie until `TRUST_PROXY` is set.** Every guest-facing call
is made *by the web server*, not by a browser — so without it the API sees
one address for the entire internet, and per-IP rate limiting becomes a
kill switch anybody can pull for everybody. `apps/web/lib/org-api.ts`
forwards `X-Forwarded-For`; the API believes it only when `TRUST_PROXY`
says so. Both halves are needed and neither is visible when it is wrong:
limiting still *works*, it just fires on the wrong person.

**Per-IP limits cannot be tight here.** Nigerian carriers NAT whole cities
behind a few addresses, so an IP is not a person. The tight limits are per
phone number (10 failed sign-ins / 15 min, 5 recovery attempts / hour) and
they count failures only — a success clears the count, or the limiter's
first victim is the organiser who fumbles their password on event morning.
Numbers and reasoning are in `apps/api/src/ratelimit.ts`.

**RLS is real, and load-bearing.** The API connects as `app_rw` /
`app_usher` / `app_public` / `app_verify` / `app_billing` — never
`postgres`. Superusers bypass RLS entirely, so connecting as `postgres`
would silently disable every policy. Dev passwords are in `003_rls.sql`;
production sets `DATABASE_URL_APP_*`. `rls.test.ts` holds 16 adversarial
tests written the way a bug would write them — keep them passing.

**Never `reply.send()` inside `asUser`/`asPass` on a write path.** The
response goes out before COMMIT, so a client can be told "created" and then
read back nothing. Return a value (or `{code, body}`) and send after.
Documented on `asUser` in `db.ts`.

It has now caused two real bugs. The second, on 28 July, was
`POST /auth/password` answering 204 before the COMMIT — a login arriving in
that window was still accepted on the *old* password. It surfaced as a
**flaky** test, which is the only reason it was caught; a test that fails
one run in six is a finding, not noise.

**Two Postgres policy traps, both already hit:**
- Policies on two tables referencing each other is mutual recursion
  (`42P17`) — use `SECURITY DEFINER` predicates (`app_member_of`,
  `app_owns_workspace`).
- `INSERT ... RETURNING` applies the SELECT policy to a row a `STABLE`
  predicate cannot see yet — key such policies on a parent column, as
  `ev_manage` does on `workspace_id`.

**The append-only log fights deletion, by design.** `check_in_events`
refuses UPDATE always (no role holds the grant) and refuses DELETE unless
the transaction set `app.erasing_event` to that event's id
(`006_event_erasure.sql`). Consequences already discovered: deleting an
*event* needs that flag; deleting a *gate* people used is impossible because
the FK's `ON DELETE SET NULL` is an UPDATE — so used gates are **closed, not
deleted**. Expect any new cascade into that table to hit the same wall.

**SSE specifics.** After `reply.hijack()` the *response* stream's `close` is
the dependable signal — `req.raw`'s doesn't reliably fire, and a leaked
subscription grows all through event day. Enrichment must be serialised per
connection or rapid scans render out of order. Both fixed in `live.ts`.

The next two only matter **if** someone turns SMS on; nothing requires it
now. They are kept because both fail silently.

**Termii's `channel` is not cosmetic.** A large share of Nigerian numbers
sit on the Do-Not-Disturb list. On the `generic` route Termii accepts the
message, answers `code: "ok"`, and never delivers it — there is no error to
find. `dnd` is the default in `env.ts`; changing it needs a whitelisted
sender ID and a reason. Termii also wants the MSISDN bare (`234…`), and a
leading `+` fails the same silent way.

**A failed SMS must delete the code row, not consume it.** The resend
rate-limit reads the newest row for the phone *regardless of `consumed_at`*,
so a consumed row would lock the user out for 30 seconds over our outage.
That delete needed a new grant (`db/migrations/007_otp_delete.sql`) —
`app_rw` had select/insert/update on `auth_otp_codes` and nothing more.

**A paused Flutter app returns stale screenshots.** `adb exec-out screencap`
on a backgrounded or idle app gives the last frame it drew while the
status-bar clock keeps advancing — so it reads exactly like a hang. Minutes
went into a "frozen" leg-open that was nothing of the sort; on a clean start
it opened in under four seconds. Wake the device before believing a
screenshot.

**Restart the API after adding a route OR changing a payload.** The note
below covers new routes; the subtler version is a *field* added to an
existing response. "Call manager" did nothing on the phone because the
running server predated the change and simply omitted `manager_phone`. Curl
the endpoint before debugging the client.

**Grants on `events` are per-column, so a new column is invisible until
granted.** Reading `events.status` from the guest page and the scanner
bootstrap failed with "permission denied for column status" — a message
that points at Postgres rather than at the migration that forgot
`grant select (status) ... to app_public, app_usher` (008). Any new column
those two roles read needs the same line.

**An HTTP call with no deadline does not fail — it hangs.** The scanner had
none, and a half-open socket (the phone leaving Wi-Fi mid-request) froze the
calling screen permanently; restoring signal did not recover it, because
nothing ever failed and so nothing ever retried. The card being tapped is
disabled while it opens, so the only escape was force-quitting. Deadlines
live in `client.dart` and cover reading the body too — a response that
starts and then stalls is the same problem as one that never starts.

**"Works offline" has to be tested from a cold start, not a warm one.**
Two separate things were only in memory: the event signing keys, and the
assignments list. Each looked fine while the app stayed open. Persisting
the keys alone fixed a screen the usher could never reach, because
"Which event?" was still a live request — the second bug was invisible
until the first was fixed *and* the app was restarted on a dead network.
Unit tests missed both because they build a `Repository` directly and call
`openLeg` themselves. Android kills backgrounded apps freely; treat an
app restart at a venue with no signal as the ordinary case.

**A hidden field and a checkbox sharing a name never turns on** —
`FormData.get()` returns the *first* value. Give the checkbox its own name
and treat absence as false.

**Asserting a DELETE is refused proves nothing** unless it runs as someone
RLS lets see the rows; otherwise it matches zero rows and "succeeds".

**Windows / dev quirks.** `import.meta.url` run-directly checks need
`pathToFileURL`. cmd.exe doesn't expand globs in npm scripts, so test files
are listed explicitly in `package.json`. `fetch().text()` **strips a BOM** —
proxy CSV through `arrayBuffer()` or Excel mangles Nigerian names. Windows
`curl` can't read Git-Bash paths (`/c/...`); use `C:/...`.

**Restart the API after adding a route file** — the preview server doesn't
hot-reload new registrations, and the symptom is a confusing 404.

---

## 6. Suggested order

1. ~~SMS~~ · ~~scanner on a real device~~ · ~~the QR read~~ ·
   ~~cancellation + onboarding~~ · ~~web scanner fallback~~ · ~~walk-ins~~ ·
   ~~Recent and undo~~ · ~~Call manager~~ — all done, and where it matters
   watched working on a handset.
2. **Deploy to staging.** Needs accounts and nothing else; no messaging
   provider is involved. `DEPLOY.md` is the runbook.
3. **A real run-through** on that box with a real guest list and a real
   WhatsApp send — the first time any of this meets a real person.
4. ~~Rate limiting~~ — done ahead of the deploy rather than after it,
   since the gap opens the moment staging has a URL. Remember `TRUST_PROXY`.
5. Audio at the gate → setup wizard → super admin.

---

## 7. Commit history

```
b3e5612  "Call manager" has somebody to call
558a8a1  recent list, and undo after the fact
95579f8  SMS recorded as optional
166cbac  sign up and recover with no SMS
88a2e6c  usher invite links, organiser passwords
00a4ac6  walk-ins in the scanner, with no signal
1879684  walk-ins: endpoint and web scanner
2326e34  name the server the scanner could not reach
807da54  QR decoding without BarcodeDetector
14311ff  the web scanner fallback
8ca27ae  a scan decided on the server
1f7d7ba  STATE.md on deployment
5531643  STATE.md: cancellation and onboarding
b2b6605  ask an organiser their name
d0c7b01  cancelling an event actually cancels it
2c84380  STATE.md after the first hardware run
1c594fc  scanner: survive a phone with no signal
72ea027  STATE.md history
a27187d  SMS delivery for OTP login
f349a66  STATE.md, expanded
c8552d9  STATE.md
8e938c1  gates and team — the launch blocker
8093660  event settings + delete vs the append-only log
2335cc4  SSE live check-in feed
d443aa3  tables and seating
fca6d26  import: pick the file once
15aebba  CSV guest-list import
3ca459f  reports + CSV export
799d881  Paystack payments
89b73c6  Row-Level Security
42cbe77  marketing homepage
12343a6  organiser dashboard
a9a167e  guest pages
f1fdd66  scanner app
f41e2b2  scanner core (Dart port)
6e1ba84  scanner bootstrap + public endpoints
5b01ba0  POST /scanner/check-ins
3c00671  workspace + API skeleton
bfab26c  fix flaky tamper test
04bf7a1  import handoff bundle
```
