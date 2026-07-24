# Project Handoff

**An event guest and access management platform.**
Households get invited, reply, receive a pass, and are scanned in at the gate.

Launching in Nigeria, weddings first, built to expand into corporate, religious,
university and government events.

Everything below was decided across a long design conversation. Nothing here is
speculative — where something is still open, it says so explicitly.

---

## How to use this bundle

Read this file first. It is the whole project in one place.

Then, depending on what you're building:

| Building | Read |
|---|---|
| Database | `spec/schema-v1.sql` — runs clean on Postgres 16, tested with real data |
| API | `spec/openapi-v1.yaml` — generate both clients, never hand-write one |
| Check-in logic | `code/checkin-core/` — 35 passing tests, already written |
| The gate | `spec/phase-4c-checkin-state-machine.md` — the reasoning |
| Any UI | Open the matching file in `mockups/` in a browser |

**Do not reimplement the check-in logic.** It exists, it's tested, and its test
suite is the specification. Wrap it.

---

## 1. The product

**Core loop:** create event → build household list → send on WhatsApp → guests
reply → each household gets a pass → ushers scan at the gate → live attendance →
report afterwards.

**Five surfaces:**

1. **Public website** — marketing, SEO, signup
2. **Organiser dashboard** — desktop-first web, where the work happens
3. **Guest experience** — mobile web, no app install, ever
4. **Scanner** — native mobile, offline-first, used by ushers
5. **Super admin** — three internal screens, deliberately minimal

**The one thing that makes it different:** the unit of invitation is a
**household**, not a person. "Mr & Mrs Adeyemi, admits 4" is one row, one pass,
one QR code. When three arrive and one is still parking, the usher admits three
and the pass stays live for the fourth. Every competitor issues one code per
person and treats a second scan as fraud.

---

## 2. Where this sits in the market

Studied: Eventbrite, Cvent, Bizzabo, Whova, zkipster, Envoy, RSVPify, and — most
importantly — **Ekaabo** (ekaabohq.com), a Lagos company shipping a very close
product right now.

### What Ekaabo already has

WhatsApp QR delivery · offline check-in · walk-in registration · pay-per-event
pricing · 150 free guests · plus-one support · public event portal · badge
generation · multi-day sessions · Google Sheets sync.

Assume none of those are differentiators.

### What their pricing actually is

Verified by signing up, not from their marketing:

- **₦14,000 for 200 guests** — roughly ₦70 a head
- **WhatsApp messaging is ₦120 per message**, sold as credit packs
- SMS ₦10 per segment
- Custom email sender is a ₦5,000 add-on
- Guest credits are an **account wallet**, not per-event
- Payments via **Flutterwave**

Their "no feature locked behind a higher price" claim does not survive contact
with the product: on the event creation screen, *check-in scanning*, *walk-in
registration*, *self check-in*, *table assignment* and *multi-location* are all
toggles on a page whose button says **Pay now**.

### The opening

**Messaging.** They're on the WhatsApp Business API and resell it at ₦120 a
message. This product opens the organiser's own WhatsApp with the message
pre-written — no API, no per-message cost, nothing to resell.

A 186-household wedding: ₦22,320 of messaging on Ekaabo, **zero** here. With
reminders it approaches ₦67,000.

The trade-off is honest: theirs sends in bulk automatically, ours needs one tap
per household — about fifteen minutes for 186. Most couples will take fifteen
minutes to save ₦22,000. Offer automated API sending as a paid add-on later so
you match at the top and undercut at the bottom.

### Two things they have that this spec didn't

Both are now in the schema:

- **Multi-leg events** — traditional in Abuja, white wedding in Lagos
- **Multi-day sessions** — church programmes, conferences *(schema-ready, not built)*

---

## 3. Pricing

Priced by **people**, not invitations. Every feature on every plan.

| Tier | People | Price | Per head |
|---|---|---|---|
| Free | 150 | ₦0 | — |
| Small | 300 | ₦7,500 | ₦25 |
| Standard | 600 | ₦15,000 | ₦25 |
| Large | 1,200 | ₦25,000 | ₦21 |
| Grand | 2,500 | ₦40,000 | ₦16 |

**Professional** ₦25,000/mo or ₦240,000/yr — breaks even around 16 events a year.
Below that, one-off pricing is cheaper and the pricing page says so.

### Why these numbers

Nigerian wedding catering runs ₦5,000–₦12,000 a plate; the average wedding costs
around ₦13m, Lagos ₦15–25m. ₦15,000 for a 600-guest wedding is **0.1% of budget,
about three plates of food.** The original ₦5,000 wasn't cheap — it wasn't
credible.

Against Ekaabo at ~₦70/head plus ₦120/message, this is roughly **five times
cheaper** on a 200-guest event.

### Rules that must hold

- **A pass counts against the limit when its invitation is sent or opened** —
  never at import. Building a list is always free.
- **Walk-ins are admitted even when they exceed the plan.** Flag it, invoice
  after. Never block a real person at a gate over billing.
- Guests never pay anything, ever.
- Never charge per QR code.

Payments: Paystack (1.5% + ₦100, capped ₦2,000, ₦100 waived under ₦2,500) or
Flutterwave (1.4% + ₦100). Webhook-driven; never trust a client callback.

---

## 4. The eight architectural decisions

These reshaped the original design. Each one is load-bearing.

**1 · Passes are issued at invitation, not after RSVP.**
Many Nigerian guests simply turn up. No pass means a failure at the gate the
organiser blames on you. RSVP updates a pass's status; it doesn't create it.
Gating entry on RSVP is a per-event policy, off by default.

**2 · The unit of invitation is a household, not a person.**
One row, one allowance, one pass. This single mechanism replaces plus-ones,
guest groups and individual-vs-group QR codes. They stop being features.

**3 · The token is offline-verifiable by design.**
HMAC-signed, self-verifying, per-event secret. Offline shipped later would
otherwise mean redesigning both the token and the write path.

**4 · WhatsApp deep links, not the Business API.**
`wa.me` with a prefilled message. Zero messaging cost. See §2.

**5 · The paywall is on sending, not storing.**
Import 500 households free. The wall appears at Send Invitations, once the
data-entry work is done and switching cost is high.

**6 · Workspaces are hidden until needed.**
Auto-created, `is_implicit = true`, switcher hidden. A couple never learns the
word. A planner gets it the moment they add a second client.

**7 · Phone is the primary identifier.** Email optional everywhere.
Three roles, not five: Owner, Event Manager, Usher.

**8 · Super admin is three screens.** Not a product. Build it last.

**Plus, added later: multi-leg events.** One event, several ceremonies, each with
its own date, venue, gates, tables, allowances and RSVPs. One pass covers all
legs.

---

## 5. Data model

Full DDL in `spec/schema-v1.sql`. Shape:

```
workspace → event → leg → entrance / seating_table
                  → invitation (household)
                       ├── invitation_leg   (allowance, rsvp, table — PER LEG)
                       ├── guest            (named person — OPTIONAL)
                       └── pass (one)
                              └── check_in_events   (append-only)
```

### Five rules that must not be broken

**Every event has at least one leg.** Created in the same transaction. A
single-venue wedding has one and the UI never says the word. This is what keeps
every query joining through `event_legs` with no nullable branching.

**One pass per household, covering the whole event.** Not one per leg. The guest
keeps a single QR that works everywhere; which leg it admits them to is resolved
against `invitation_leg` at scan time. The scanner holds that locally, so it
still works offline.

**Naming individuals is optional.** An invitation with `allowance: 6` and zero
`guests` rows is complete and valid. After a CSV import it's the common case —
in testing, only 21% of households ever get named.

**Nothing about attendance is a mutable flag.** `admitted` is a SUM over the
append-only log. That is what lets two offline phones reconcile without a
conflict. `check_in_events` has a trigger blocking UPDATE and DELETE.

**Billing counts the largest allowance across legs, not the sum.** Six people at
the traditional and two at the white wedding is six humans, not eight. Verified:
naive sum 850, correct charge 655.

### Two bugs found by running it — already fixed, don't reintroduce

**Append-only via RULE breaks `ON CONFLICT`.** Postgres refuses `ON CONFLICT` on
any table carrying an INSERT or UPDATE rule — and idempotent replay of an offline
queue *is* an upsert. Use a **trigger**. It works with `ON CONFLICT` and fails
loudly instead of silently swallowing the write.

**Partial RSVPs must count as confirmed.** A household replying "three of our
four are coming" is promising three people. Filtering `confirmed_people` to
`rsvp = 'attending'` alone lost 55 of 427 on test data — and the caterer's number
is one of the two things this product exists to get right.

---

## 6. The check-in state machine

Implemented and tested in `code/checkin-core/`. Reasoning in
`spec/phase-4c-checkin-state-machine.md`.

**Evaluation order.** Stop at the first failure.

```
decode → signature → event match → leg entitlement → revocation
      → RSVP gate → allowance → admission → overflow
```

**Signing keys.** A device holds keys for **every event its usher works**, not
just the current one. With one key you cannot tell a forgery from last week's
wedding. With all of them the gate says *"this pass is for Yusuf & Maryam"* —
the difference between a useful message and a shrug.

**Sixteen outcomes.** Green ones auto-return to the camera; amber and red wait
for a human, because a refusal means a conversation is happening at the gate.

**Invariants** (the last four tests in the suite — protect them):

- Only admissions reset the camera by themselves
- Refusals admit nobody
- Every refusal is logged — that report is one of the things organisers value most
- The count prompt is the only unlogged outcome

**Idempotency.** The device generates a `client_uuid` per scan. A replay returns
the stored outcome. Without this, a flaky connection double-admits a household.

**Server rule.** Re-run `decide()` against database state when the queue arrives.
Trust the device for *what happened at the gate*, never for *whether it was
allowed*.

**Two offline phones, same pass.** Both admit. Both rows land. The sum exceeds
allowance. **Do not retroactively deny anyone** — the people are already inside.
Flag it and move on.

---

## 7. Design

Full mockups in `mockups/`. Open in a browser; most are interactive.

### One brand, three personalities

| Surface | Feel | Priority |
|---|---|---|
| Organiser | Professional, organised | Clarity |
| Guest | Elegant, celebratory | Emotion |
| Scanner | Fast, reliable | Speed |

### Tokens

**Light (organiser, public):**
`--p900:#163300` `--p600:#2F6B1C` `--p100:#E8F1E4` `--p50:#F5F9F3`
`--bg:#FAFAF7` `--surface:#FFF` `--line:#E5E7E2`
`--ink:#171A16` `--ink-2:#5F665C` `--ink-3:#8A9187`
Success `#2E7D32` · Warning `#B7791F` · Error `#C62828`

**Dark (scanner)** — the light semantics are too dim on charcoal:
`--ground:#12140F` `--surface:#1C1F19` `--line:#333829`
Admit `#4ADE80` · Hold `#FBBF24` · Deny `#F87171`

**Guest (invitation):**
Forest `#14300F` → `#0C1D08`, ivory `#F7F4EC`, gold hairline `#C9A961`

**Type:** Inter everywhere functional. **Cormorant Garamond 300** for the guest
invitation — not Playfair, which is the reflexive wedding choice and reads as
templated.

**Geometry:** 8px spacing · radius 10px inputs/buttons, 16px cards, 20px feature
cards · shadow `0 4px 20px rgba(0,0,0,.05)` · sidebar 240px · touch target 44px

### Decisions worth keeping

- **The invitation hero is deep forest green, not cream.** Inverts the expected
  wedding palette, uses the brand colour as the emotional centre, and sits closer
  to Nigerian invitation vernacular than European ivory.
- **On scanner result screens the guest's name is largest, the status smallest.**
  Colour, sound and haptic already carry admit-or-deny before anyone looks down.
  What the usher needs to *read* is the name they're about to say aloud.
- **Party arrival shows as pips** — ●●●○ for three of four. Scannable across 186
  rows without reading a number.
- **The dashboard is a countdown, not a report.** "18 days to go" is the largest
  element. No readiness percentage — see `spec/event-readiness-rules.md` for why.

### Mockup index

| File | Contains |
|---|---|
| `scanner-mockup.html` | 13 states, tappable, with sound/haptic/dwell notes |
| `guest-experience-mockup.html` | Invitation, details, working RSVP, pass |
| `event-workspace-mockup.html` | Guest list, tables, live check-in |
| `organiser-dashboard-mockup.html` | Countdown, run-up track, due now |
| `organiser-setup-flow-mockup.html` | Create event, import, send, detail drawer |
| `organiser-plans-reports-team-mockup.html` | Plans, billing, reports, team, settings |
| `auth-usher-admin-mockup.html` | Signup, onboarding, usher entry, admin |
| `public-website-mockup.html` | Full marketing homepage |

**Not yet designed: anything multi-leg.** The guest list has no leg switcher, the
invitation detail shows one allowance, the guest page shows one event, and the
usher flow picks event and gate but not leg. Deliberate — build the single-leg UI
as drawn, and design those views when a real customer runs two ceremonies. The
expensive part was the schema and it's done.

---

## 8. Stack

| Piece | Choice |
|---|---|
| Web (all four surfaces) | **Next.js** App Router + shadcn/ui |
| API | **Node + TypeScript**, NestJS or Fastify |
| Database | **PostgreSQL** — the core read is an aggregate, not a document |
| ORM | **Drizzle** (stays close to SQL) or Prisma |
| Scanner | **Flutter** — `mobile_scanner`, `drift`, `flutter_secure_storage` |
| Live updates | **SSE** over Postgres `LISTEN/NOTIFY` |
| SMS / OTP | **Termii** or **Africa's Talking** — better than Twilio in Nigeria |
| Payments | Paystack or Flutterwave, webhook-driven |
| Storage | Cloudflare R2 |
| Hosting | Vercel (web) + Railway/Fly (API), EU region |

### Four decisions that are expensive to reverse

**No tRPC.** It's TypeScript-to-TypeScript and locks Flutter out. REST with the
OpenAPI spec as contract; generate the TS and Dart clients from one file.

**No Flutter desktop app.** It duplicates screens that already work in a browser
and costs three platform builds, notarisation, code signing and an auto-updater
for zero user benefit. Nobody planning a wedding installs a desktop app.

**Flutter is for the scanner only.** Not the organiser app — the dashboard is
responsive and that covers event-day. Build a stripped-down **web scanner
fallback** too: ushers are casual staff hired for the night and some will arrive
having installed nothing. Two days of work, saves an event.

**shadcn belongs in the dashboard, not the guest page.** Guest routes are server
components with near-zero client JS. That page loads on a mid-range Android on
Nigerian mobile data and is the first thing 500 strangers see.

### Repository shape

```
/apps
  /web        Next.js — route groups: (marketing) (app) (guest) (admin)
  /api        Node service
  /scanner    Flutter
/packages
  /contract   OpenAPI spec + generated TS client
```

---

## 9. Build order

1. **Schema + auth + the invitation/pass/check-in core**
2. **The check-in endpoint**, wrapping `checkin-core`, with the Phase 4C outcomes as its test suite
3. **Flutter scanner**, against the real API — riskiest surface, find its problems first
4. **Guest pages** — small, server-rendered, second-riskiest
5. **Organiser dashboard**
6. Payments → WhatsApp link generation → reports
7. Marketing site last

Most teams build the dashboard first because it feels like the product. The
dashboard is CRUD. **Build the gate first.**

---

## 10. Still open

**Owed by the founder:**

- **Brand name.** Deliberately deferred. Everything says "Working name" and
  `gtfd.ng`. Before committing to any name: check domains, and search the NIPO
  register. Note CAC registration does *not* protect a brand — trademark is a
  separate filing, Class 9 for downloadable software and Class 42 for SaaS, and
  you need both.
- **Positioning.** Currently weddings-first with an institutional section at the
  bottom of the homepage. The alternative — leading with controlled access for
  corporate, religious and university buyers — pays more and churns less but is
  slower and needs references you don't have.

**Product questions deferred, not forgotten:**

- Larger tiers above 2,500 people
- Multi-day sessions (schema-ready, not built)
- Cross-device undo permissions
- Re-entry and check-out (`occupancy_delta` column already supports it)
- Automated WhatsApp API sending as a paid add-on
- Row Level Security — must be on before launch; ushers must never reach
  `invitations.primary_phone`

**An untapped channel worth a few phone calls:** event ushering is already a
professional industry in Nigeria. Couples hire ushering companies who work dozens
of weddings a season. Nobody is selling to them, and one company with this
scanner on every job is distribution that doesn't depend on winning couples one
at a time. That's who the Professional plan should target.

---

## 11. File index

```
HANDOFF.md                    ← this file

spec/
  schema-v1.sql               Postgres DDL. Tested. Runs clean.
  openapi-v1.yaml             API contract. Generate clients from this.
  architecture-v2.md          The eight decisions, in detail
  phase-4c-checkin-state-machine.md   Every scan outcome and why
  event-readiness-rules.md    Time-aware readiness, and why not a percentage
  commercial-decisions.md     Competitor findings, pricing, naming
  stack-recommendation.md     Full stack rationale

code/
  checkin-core/               The state machine. 35 tests. `npm test`.
    src/token.ts              HMAC pass tokens, 64 chars
    src/checkin.ts            decide() — pure, no I/O
    src/checkin.test.ts       The specification, executable
    README.md

mockups/                      8 HTML files. Open in a browser.
```
