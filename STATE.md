# Where this build has got to

Companion to `HANDOFF.md`, which remains the source of truth for *why*
anything is the way it is. This file records *what exists*, what doesn't,
and what will bite whoever picks it up next — including me, later.

Written 26 July 2026 · branch `main` · 29 commits · **nothing deployed**.

---

## 1. Run it from cold

```bash
# Postgres 17 running locally, trust auth for the postgres user.
psql -U postgres -h localhost -c "create database guest_dev"
psql -U postgres -h localhost -d guest_dev -f spec/schema-v1.sql
for f in db/migrations/*.sql; do psql -U postgres -h localhost -d guest_dev -f "$f"; done

npm install                                   # workspace root
cp apps/api/.env.example apps/api/.env
npx tsx apps/api/scripts/seed-demo.ts         # prints working guest URLs

npm run start --workspace api                 # :3001
npm run dev   --workspace web                 # :3000
```

Sign in at `http://localhost:3000/login` as `+2348030000001` (organiser) or
`+2348030000002` (usher). **The OTP is printed on the login page in dev** —
with `TERMII_API_KEY` unset the API falls back to a `LogSender` and returns
the code as `dev_code`. Set the key and both the log line and `dev_code`
stop; see §5 *SMS*.

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
npm test --workspace api            # 220
npm test --workspace checkin-core   # 40
cd apps/scanner && flutter test     # 74
```

Tests rebuild a disposable `guest_test` from `spec/schema-v1.sql` plus every
file in `db/migrations/` on each run (`apps/api/src/testdb.ts`). **Never
point tests at `guest_dev`** — the check-in log is append-only and test rows
could never be cleaned out.

---

## 2. Shape

```
apps/api        Fastify 5 + postgres.js (raw SQL, no ORM)   ~9,900 lines · 220 tests
apps/web        Next.js 16 App Router                        ~6,500 lines · 15 pages
apps/scanner    Flutter 3.44 + drift + mobile_scanner         ~6,400 lines ·  74 tests
packages/checkin-core   the handoff's own state machine                    ·  40 tests
db/migrations   8 migrations layered on spec/schema-v1.sql
spec/           untouched handoff artefacts — schema, OpenAPI, architecture
design/mockups/ untouched; the dashboard copies their tokens by hand
```

Both the web app and the Flutter scanner talk to the **one** backend,
`apps/api`. `spec/openapi-v1.yaml` is the shared contract.

### API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/otp/request` · `POST /auth/otp/verify` · `GET/PATCH /me` |
| Events | `GET/POST /events` · `GET/PATCH/DELETE /events/:id` · `GET /events/:id/settings` · `POST /events/:id/reissue-passes` · `PATCH /legs/:id` |
| Guest list | `GET/POST /events/:id/invitations` · `POST /events/:id/invitations/import` · `PUT/DELETE /invitations/:id/legs/:legId` |
| Sending | `POST /events/:id/delivery-links` (wa.me — **the billing gate**) |
| Gates & team | `GET/POST /legs/:id/entrances` · `PATCH/DELETE /entrances/:id` · `GET/POST /legs/:id/staff` · `PATCH/DELETE /staff/:id` |
| Seating | `GET/POST /legs/:id/tables` · `PATCH/DELETE /tables/:id` · `GET /legs/:id/unseated` |
| Gate | `GET /scanner/assignments` · `GET /scanner/legs/:id/bootstrap` · `POST /scanner/legs/:id/test` · `POST /scanner/check-ins` |
| Live | `GET /legs/:id/attendance` · `GET /legs/:id/live` · `GET /legs/:id/stream` (SSE) |
| Reports | `GET /events/:id/report` (+ `?format=csv`) |
| Money | `GET /events/:id/billing` · `POST /events/:id/checkout` · `POST /webhooks/paystack` |
| Guest | `GET /public/invitations/:token` · `POST /public/invitations/:token/rsvp` |

### Web pages

`/` marketing · `/login` · `/welcome` name yourself ·
`/i/[token]` guest invitation · `/events` ·
`/events/[id]` countdown home · `…/guests` · `…/guests/import` ·
`…/guests/[invId]/link` · `…/tables` · `…/team` · `…/live` · `…/report`
(+ `/export`) · `…/billing` · `…/settings`

---

## 3. Decisions already made — don't re-litigate

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
  both are wrong.
- **Prices live only in `apps/api/src/plans.ts`.** Checkout names a *plan*,
  never an amount.
- **Only a signed webhook upgrades a plan**, and it re-checks the amount
  against our own quoted row.
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

1. **SMS is built, but has never sent a real message.** The code is done
   (`apps/api/src/sms.ts`, 13 tests in `sms.test.ts`) and the whole design
   below is implemented; what is missing is a Termii account. Nobody has
   watched a code land on a handset, and the sender ID has not been
   registered. Until someone does, treat delivery as unproven — the
   provider contract is pinned by tests against a stubbed `fetch`, which
   proves the payload shape and nothing about Termii's behaviour.
   - **Still to do by hand:** open a Termii account, fund it, register a
     sender ID (or use their pre-approved `N-Alert`), set `TERMII_API_KEY`,
     then send one real code to a real Nigerian number — ideally one on the
     DND list.
2. **The scanner has run on a phone — but has never read a real QR code.**
   Verified 26 July 2026 on a Xiaomi 23106RN0DA, Android 14, arm64, against
   the API over `adb reverse`. What is now proven on hardware: build and
   install, OTP login, camera preview and the runtime permission prompt,
   bootstrap into drift, offline search, manual check-in reaching Postgres
   with a real `device_id`, the offline queue, and reconnect sync. Release
   APK builds and its merged manifest carries `CAMERA` and `INTERNET` (both
   arrive from plugins; the app's own manifest declares neither).
   - **Still unproven: the decode path.** Every check-in in that session
     went through *Search by name*. No QR has been put in front of the lens,
     so `mobile_scanner` reading a real pass — focus, low light, a phone
     screen behind glass, a printed card at a Lagos reception — is still
     untested. That is now the highest-risk unknown.
   - **No error path for a denied camera.** `MobileScanner` is constructed
     with no `errorBuilder` (`scan_screen.dart` ~line 260), so an usher who
     taps Deny gets the plugin's own bare error box and no route to
     settings.
3. **Scanner gaps.** "Add walk-in" and "Call manager" dismiss without doing
   anything (`apps/scanner/lib/ui/scan_screen.dart` ~line 193); the "Recent"
   button does nothing; no audio tones (phase-4c §5 specifies sound, we ship
   haptics only); no undo from a recent list. **A walk-in also needs an API
   endpoint — it doesn't exist.** Two more found on the device: a back-press
   on the scan screen drops the usher out of the leg entirely with no
   confirm, even mid-result; and the app installs under the label
   `scanner` (`android:label`, never set).
4. **Deployment.** Nothing anywhere. No CI, hosting, domain, secrets
   management, backups or migration runner. Target: Vercel (web) +
   Railway/Fly (API), EU region.
5. **Event creation is one thin form.** The setup mockup has five steps
   (details, venue, guests & entry, tables, review).

### Wanted before charging strangers

Web scanner fallback (the handoff calls it two days that "saves an event" —
casual staff arrive having installed nothing) · super admin's three screens ·
guest-page accessibility and performance pass · rate limiting on public
endpoints · error monitoring and structured logs · PDF report · email as a
delivery channel · Paystack **live** keys (`StubProvider` refuses to run in
production).

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

**RLS is real, and load-bearing.** The API connects as `app_rw` /
`app_usher` / `app_public` / `app_verify` / `app_billing` — never
`postgres`. Superusers bypass RLS entirely, so connecting as `postgres`
would silently disable every policy. Dev passwords are in `003_rls.sql`;
production sets `DATABASE_URL_APP_*`. `rls.test.ts` holds 16 adversarial
tests written the way a bug would write them — keep them passing.

**Never `reply.send()` inside `asUser`/`asPass` on a write path.** The
response goes out before COMMIT, so a client can be told "created" and then
read back nothing. Return a value (or `{code, body}`) and send after.
Documented on `asUser` in `db.ts`; it already caused one real bug.

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

1. ~~SMS~~ — built. Left to do: a Termii account and one real delivery (§4.1).
2. ~~Scanner on a real device~~ — done, and it paid for itself (§4.2).
   What remains is **putting a real QR in front of the lens**; do that
   before building walk-in, Recent and audio on top of it.
3. ~~Cancellation + onboarding~~ — done; the UI no longer promises more
   than it does.
4. **Deploy to staging** with Paystack test keys.
5. Web scanner fallback → setup wizard → super admin.

---

## 7. Commit history

```
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
