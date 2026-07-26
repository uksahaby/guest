# Where this build has got to

Companion to `HANDOFF.md`, which is still the source of truth for *why*
anything is the way it is. This file records *what exists*, what doesn't,
and the things that will bite whoever picks it up next.

Written 26 July 2026. Branch `main`, 12 commits, nothing deployed anywhere.

---

## 1. Run it

```bash
# Postgres 17 must be running locally, trust auth for the postgres user.
psql -U postgres -h localhost -c "create database guest_dev"
psql -U postgres -h localhost -d guest_dev -f spec/schema-v1.sql
for f in db/migrations/*.sql; do psql -U postgres -h localhost -d guest_dev -f "$f"; done

npm install                                   # workspace root
cp apps/api/.env.example apps/api/.env
npx tsx apps/api/scripts/seed-demo.ts         # prints working guest URLs

npm run start --workspace api                 # :3001
npm run dev   --workspace web                 # :3000
```

Then `http://localhost:3000/login` and sign in as `+2348030000001`. **The
OTP is printed on the login page in dev** — SMS is not wired up.

`.claude/launch.json` defines both servers for the Browser pane.

Tests:

```bash
npm test --workspace api          # 194
npm test --workspace checkin-core # 35
cd apps/scanner && flutter test   # 47
```

Test DBs are disposable: `apps/api/src/testdb.ts` drops and rebuilds
`guest_test` from `spec/schema-v1.sql` + every file in `db/migrations/`
on each run. Never point tests at `guest_dev` — the check-in log is
append-only and test rows could never be cleaned out.

---

## 2. What exists

```
apps/api        Fastify 5 + postgres.js   ~9,400 lines, 194 tests
apps/web        Next.js 16 (App Router)   ~6,500 lines, 15 pages
apps/scanner    Flutter 3.44 + drift      ~6,100 lines,  47 tests
packages/checkin-core  the handoff's own state machine, 35 tests
db/migrations   6 migrations on top of spec/schema-v1.sql
```

**API** — OTP auth · `/me` · the gate (`/scanner/check-ins`, bootstrap,
assignments, readiness) · guest pages (`/public/invitations/:token`) ·
events, invitations, WhatsApp delivery links · RLS with five roles ·
Paystack checkout + webhook · reports + CSV · CSV import · tables ·
SSE live feed · settings · gates and team.

**Web** — marketing homepage (`/`), guest invitation (`/i/[token]`), and
the organiser dashboard: events list, countdown home, guest list, import,
WhatsApp link, billing, report, tables, live check-in, settings, team.

**Scanner** — Dart port of `checkin-core` with a pinned cross-language
token vector, drift offline store, sync worker, camera, all 13 result
states, OTP login, offline queue with reversals.

---

## 3. What is NOT done

### Blocks a real wedding
1. **SMS.** OTP codes are `app.log.info` only — see `TODO(launch)` in
   `apps/api/src/auth.ts`. In production **nobody can sign in.** Termii or
   Africa's Talking.
2. **The scanner has never run on a phone.** No emulator, no device. The
   logic is heavily tested but camera, permissions, drift-on-device and
   real offline behaviour are all unverified. Highest-risk unknown in the
   project.
3. **Scanner gaps** — "Add walk-in" and "Call manager" dismiss without
   doing anything (`apps/scanner/lib/ui/scan_screen.dart`, ~line 193); the
   "Recent" button does nothing; no audio tones (haptics only, though
   phase-4c specifies sound); no undo from a recent list.
   A walk-in also needs an API endpoint — it doesn't exist.
4. **Cancelling an event does nothing visible.** `status = 'cancelled'`
   saves, but the guest page shows no notice and passes still verify at the
   gate. The settings page promises both. Pick one: honour it or change the
   copy.
5. **Onboarding.** Users are created with `full_name = ''` and nothing ever
   asks. An organiser's first event workspace is named after an empty
   string.
6. **Deployment.** Nothing is deployed. No CI, no hosting, no domain, no
   secrets management, no backups, no migration runner. Target per the
   stack rec: Vercel (web) + Railway/Fly (API), EU region.
7. **Event creation is one thin form.** The setup-flow mockup has five
   steps (details, venue, guests & entry, tables, review); ours collects a
   name, a date and a venue.

### Wanted before charging strangers
- **Web scanner fallback.** The handoff calls this two days of work that
  "saves an event" — casual staff turn up having installed nothing.
- Super admin (three screens; the handoff says build last).
- Guest page: accessibility and performance pass. It's the page 500
  strangers open on mid-range Android over Nigerian mobile data.
- Rate limiting on public endpoints; error monitoring; structured logs.
- PDF report ("Download PDF" is in the mockup, only CSV exists).
- Email as a delivery channel, custom sender.
- Paystack live keys (needs a registered business); the local stub is
  `StubProvider` in `apps/api/src/paystack.ts` and refuses to run in prod.

### Deferred by the handoff itself — not oversights
Multi-leg UI (schema is ready, UI deliberately not designed until a real
customer runs two ceremonies) · multi-day sessions · re-entry / check-out
(`occupancy_delta` already supports it) · cross-device undo · automated
WhatsApp API sending as a paid add-on · tiers above 2,500.

### Only the founder can do
Brand name and domain · NIPO trademark search (Class 9 **and** 42) ·
positioning call (weddings-first vs access-control-first) · Paystack
business account · the first real couple.

---

## 4. Things that will bite you

**RLS is real.** The API connects as `app_rw` / `app_usher` / `app_public`
/ `app_verify` / `app_billing`, never `postgres`. Superusers bypass RLS, so
connecting as `postgres` would silently disable every policy. Dev passwords
are in `003_rls.sql`; production should set `DATABASE_URL_APP_*`.

**Never `reply.send()` inside `asUser`/`asPass` on a write path.** The
response goes out before COMMIT, so a client can be told "created" and then
read back nothing. Return a value (or `{code, body}`) and send after. This
is documented on `asUser` in `db.ts` and it has already caused one real bug.

**Two Postgres traps, both already hit:**
- Policies on two tables referencing each other is mutual recursion
  (`42P17`). Use `SECURITY DEFINER` predicates — see `app_member_of`,
  `app_owns_workspace`.
- `INSERT ... RETURNING` applies the SELECT policy to a row a `STABLE`
  predicate cannot see yet. Key such policies on a parent column, as
  `ev_manage` does on `workspace_id`.

**The append-only log fights deletion, by design.** `check_in_events`
refuses UPDATE always (no role even holds the grant) and refuses DELETE
unless the transaction has set `app.erasing_event` to that event's id
(`006_event_erasure.sql`). Consequences already discovered:
- deleting an *event* needs that flag;
- deleting a *gate* people used is impossible, because the FK's
  `ON DELETE SET NULL` is an UPDATE — so used gates are closed, not deleted.
Expect any new cascade into that table to hit the same wall.

**SSE specifics.** After `reply.hijack()` the *response* stream's `close`
is the dependable signal; `req.raw`'s doesn't reliably fire, and a leaked
subscription grows all through event day. Enrichment must be serialised per
connection or rapid scans render out of order. Both fixed in `live.ts`.

**A hidden field and a checkbox sharing a name never turns on** —
`FormData.get()` returns the *first* value. Give the checkbox its own name
and treat absence as false.

**Windows/dev quirks.** `import.meta.url` run-directly checks need
`pathToFileURL`. cmd.exe doesn't expand globs in npm scripts, so test files
are listed explicitly. `fetch().text()` strips a BOM — proxy CSV through
`arrayBuffer()` or Excel mangles Nigerian names.

**Asserting a DELETE is refused proves nothing** unless it runs as someone
RLS lets see the rows; otherwise it matches zero rows and "succeeds".

---

## 5. Suggested order

1. **SMS** — without it there is no login in production. Small, unblocking.
2. **Scanner on a real device** — before building more scanner features,
   find out what breaks. Then walk-in, Recent, audio.
3. **Cancellation + onboarding** — two small honesty fixes.
4. **Deploy something** to a staging URL with real Paystack test keys.
5. **Web scanner fallback**, then the setup wizard, then super admin.

The spec files in `spec/` have not been edited except to fill in
`table_name` / `rsvp_count`, which were already in the contract and simply
weren't implemented. `design/mockups/*.html` are untouched and remain the
visual reference — the dashboard copies their tokens rather than importing
a component library.
