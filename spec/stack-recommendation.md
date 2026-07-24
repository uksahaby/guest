# Stack Recommendation

Assessed against what this system actually has to do: verify signed tokens on a phone with no signal, admit part of a household, and never lose a check-in.

---

## Verdict on your plan

| Your plan | My view |
|---|---|
| Flutter — mobile | **Yes**, for the scanner only |
| Flutter — desktop | **Cut it.** Reasoning below |
| Next.js + shadcn — website | **Yes**, and it should carry four surfaces, not one |
| Node.js — backend | **Yes**, with PostgreSQL, and some specifics that matter |

---

## 1. Cut the desktop app

The desktop app would be a second implementation of screens that already work in a browser, and it would cost you:

- Separate builds for Windows, macOS and Linux
- Apple notarisation and Windows code signing
- An auto-update mechanism you have to build and maintain
- No shareable links, no SEO, no "open this on your laptop and carry on"

And it buys nothing. **Nobody planning a wedding wants to install a desktop application.** The organiser dashboard is already specified as desktop-first web — a browser on a laptop *is* the desktop app.

If a genuine offline-desktop need appears later (a university registry running a matriculation from a laptop in a hall with no wifi), build it then, informed by a real customer.

---

## 2. Flutter's real job is the scanner — and only the scanner

The scanner is the one surface with a proper native case:

- Camera decode speed, on cheap Android phones, in bad light
- A local SQLite queue that survives the app being killed
- Per-event HMAC secrets in platform secure storage
- Background sync that actually runs when signal returns

A PWA can do most of this, but iOS can evict IndexedDB under storage pressure, and background sync on iOS is unreliable. **Losing a night's check-ins because the browser cleared storage is the one failure that would kill this product's reputation.** Native storage is worth the extra codebase.

**Packages:** `mobile_scanner` (decode), `drift` (SQLite with proper queries), `flutter_secure_storage` (event keys), `connectivity_plus` + a queue worker (sync), `crypto` (HMAC verify).

### But build a web scanner fallback too

Ushers are casual staff hired for the night. Some will turn up having installed nothing. A stripped-down web scanner in the Next.js app — online-only, no offline queue — means those people can still work the gate. It's maybe two days of work and it saves an event.

### Defer the organiser mobile app

The dashboard is responsive. What an organiser needs on their phone during the event is the live numbers, and a responsive web page does that. Revisit after you've run real weddings.

---

## 3. The decision that's expensive to reverse: no tRPC

For a Next.js + Node stack, tRPC is the obvious reach. **Don't.** It's TypeScript-to-TypeScript and it locks Flutter out entirely — you'd end up hand-writing a parallel Dart client and drifting out of sync within a month.

**Use REST with an OpenAPI spec as the contract.** Generate the TypeScript client for Next.js and the Dart client for Flutter from the same file. One source of truth, two languages, no drift.

This has to be decided now. Retrofitting REST after building on tRPC means rewriting the API surface.

---

## 4. Backend

**PostgreSQL. Not MongoDB.** This data model is relational — workspaces, memberships, events, invitations, passes, an append-only check-in log — and the core read is an aggregate:

```sql
SELECT COALESCE(SUM(admitted_count), 0)
FROM check_in_events
WHERE pass_id = $1
  AND result IN ('admitted','partial','manual','overflow_admitted','reversal');
```

That's a relational query with an index on `pass_id`. Start with the sum; add a trigger-maintained counter only if it becomes slow.

| Piece | Recommendation | Why |
|---|---|---|
| Language | Node + **TypeScript** | Shared types with the web app |
| Framework | **NestJS** | The permission model is the complex part; structure helps. Fastify if you'd rather stay light |
| ORM | **Drizzle** | Stays close to SQL, which matters for the aggregate queries. Prisma if you prefer the DX |
| Live dashboard | **SSE** over Postgres `LISTEN/NOTIFY` | One-way updates. WebSockets are more than this needs |
| SMS / OTP | **Termii** or **Africa's Talking** | Nigerian delivery rates and pricing beat Twilio meaningfully |
| Payments | **Paystack**, webhook-driven | Never trust the client callback |
| Storage | **Cloudflare R2** | S3-compatible, no egress fees |
| Hosting | Vercel (web) · Railway or Fly (API) | Pick an EU region — lowest realistic latency to Nigeria |

---

## 5. Three implementation rules that come straight from the spec

### Check-in writes must be idempotent

Offline devices retry. Without this, a flaky connection double-admits a guest and your counts are wrong on the night.

The Flutter client generates a UUID for every scan and sends it with the request. The server treats that UUID as a unique key and returns the existing row on a repeat. Simple, and easy to forget until it bites.

### Signing keys never leave the server

Per-event HMAC secrets go to the scanner over an authenticated channel when an usher opens an event, and into secure storage. They must never appear in the Next.js bundle, in an API response to the guest pages, or in logs.

### The guest page is the one place shadcn doesn't belong

shadcn is right for the dashboard. It is wrong for the guest invitation, which loads on a mid-range Android on Nigerian mobile data and is the first thing 500 people ever see of your product.

Guest routes should be server components with close to zero client JavaScript — the RSVP form is the only interactive element on the page. Give them their own route group and their own layout so no dashboard dependency leaks in.

---

## 6. Repository shape

One repository:

```
/apps
  /web        Next.js — marketing, dashboard, guest pages, admin
  /api        Node — the service
  /scanner    Flutter
/packages
  /contract   OpenAPI spec + generated TS client
```

Dart client generated into the Flutter app from the same spec.

**One Next.js app, four route groups:**

```
(marketing)  → public site, SEO, static
(app)        → organiser dashboard, shadcn, client-heavy
(guest)      → invitation, RSVP, pass — minimal JS
(admin)      → the three internal screens
```

Separate layouts keep the guest bundle from inheriting the dashboard's weight.

---

## 7. Build order

1. **Postgres schema + auth + the invitation/pass/check-in core.** Everything depends on it.
2. **The check-in endpoint, with the state machine and idempotency.** Write the tests against the twelve outcomes in Phase 4C — that document is a test plan.
3. **Flutter scanner.** Build it against the real API early. It's the riskiest surface; find its problems first.
4. **Guest pages.** Small, server-rendered, and the second-riskiest thing — it's what 500 strangers judge you on.
5. **Organiser dashboard.**
6. Paystack, then WhatsApp link generation, then reports.
7. Marketing site last — it's the easiest thing to rebuild once you know what you're actually selling.

Most teams build the dashboard first because it feels like the product. The dashboard is CRUD. Build the gate first.
