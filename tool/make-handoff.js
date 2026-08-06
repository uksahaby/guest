/**
 * Builds Guest-Platform-Handoff-August.docx — the continuation handoff.
 *
 *   npm i --no-save docx        # not a project dependency; nothing ships it
 *   node tool/make-handoff.js
 *
 * The .docx it writes is build output and is gitignored — this file is the
 * version that gets kept.
 *
 * Kept in the repo rather than run from a scratch directory so the next
 * version is an edit to this file instead of a rewrite. Everything it
 * states was read out of the repo or a live run on the day, not memory.
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  TableOfContents, PageBreak, LevelFormat, convertInchesToTwip,
} = require("docx");
const fs = require("fs");

const INK = "1A1A1A";
const GREEN = "14300F";
const MUTED = "5F665C";
const RED = "9B2C2C";
const LINE = "D8DCD5";

// ---------- small builders ------------------------------------------------

const H1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 380, after: 140 } });
const H2 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 } });
const H3 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } });

/** Body text. `runs` is a string or an array of {t, b, i, c, mono}. */
function P(runs, opts = {}) {
  const list = typeof runs === "string" ? [{ t: runs }] : runs;
  return new Paragraph({
    spacing: { after: opts.after ?? 120, line: 276 },
    indent: opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
    alignment: opts.align,
    children: list.map((r) =>
      new TextRun({
        text: r.t,
        bold: r.b,
        italics: r.i,
        color: r.c ?? INK,
        font: r.mono ? "Consolas" : undefined,
        size: r.mono ? 19 : 21,
      }),
    ),
  });
}

const BULLET = (runs, level = 0) => {
  const list = typeof runs === "string" ? [{ t: runs }] : runs;
  return new Paragraph({
    numbering: { reference: "dots", level },
    spacing: { after: 70, line: 272 },
    children: list.map((r) =>
      new TextRun({
        text: r.t, bold: r.b, italics: r.i, color: r.c ?? INK,
        font: r.mono ? "Consolas" : undefined, size: r.mono ? 19 : 21,
      }),
    ),
  });
};

/** A callout: tinted box with a left rule. */
function Note(title, body, tone = "green") {
  const fill = tone === "red" ? "FBEEEE" : tone === "amber" ? "FDF6E7" : "F934".slice(0, 0) + "F1F6EF";
  const bar = tone === "red" ? RED : tone === "amber" ? "B7791F" : GREEN;
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
      left: { style: BorderStyle.SINGLE, size: 18, color: bar },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 140, bottom: 140, left: 200, right: 200 },
            children: [
              new Paragraph({
                spacing: { after: 60 },
                children: [new TextRun({ text: title, bold: true, size: 21, color: bar })],
              }),
              ...(Array.isArray(body) ? body : [body]).map((b) =>
                new Paragraph({
                  spacing: { after: 40, line: 272 },
                  children: [new TextRun({ text: b, size: 21, color: INK })],
                }),
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Monospace block, for commands. */
function Code(lines) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F7F7F4" },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: lines.map((l) =>
              new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: l, font: "Consolas", size: 18, color: INK })],
              }),
            ),
          }),
        ],
      }),
    ],
  });
}

/** Data table. `widths` must sum to 9360. */
function Grid(head, rows, widths) {
  const cell = (text, opts = {}) =>
    new TableCell({
      width: { size: opts.w, type: WidthType.DXA },
      shading: opts.head
        ? { type: ShadingType.CLEAR, fill: "EFF3ED" }
        : opts.zebra
          ? { type: ShadingType.CLEAR, fill: "FAFAF8" }
          : undefined,
      margins: { top: 90, bottom: 90, left: 130, right: 130 },
      children: [
        new Paragraph({
          spacing: { after: 0 },
          children: [
            new TextRun({
              text,
              bold: opts.head,
              size: 19,
              color: opts.head ? GREEN : INK,
              font: opts.mono ? "Consolas" : undefined,
            }),
          ],
        }),
      ],
    });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: LINE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: LINE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: head.map((h, i) => cell(h, { head: true, w: widths[i] })),
      }),
      ...rows.map((r, ri) =>
        new TableRow({
          children: r.map((c, i) =>
            cell(c, { w: widths[i], zebra: ri % 2 === 1, mono: i === 0 && r.mono }),
          ),
        }),
      ),
    ],
  });
}

const SPACER = () => new Paragraph({ text: "", spacing: { after: 120 } });

// ---------- the document --------------------------------------------------

const children = [];

// Cover
children.push(
  new Paragraph({
    spacing: { before: 1400, after: 60 },
    children: [new TextRun({ text: "EVENTFLOW", bold: true, size: 24, color: GREEN, characterSpacing: 60 })],
  }),
  new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: "Continuation Handoff — August", size: 56, color: INK })],
  }),
  new Paragraph({
    spacing: { after: 340 },
    children: [new TextRun({
      text: "Everything built since the last handoff, what is deployed, what is not, and every trap already paid for.",
      size: 22, color: MUTED, italics: true,
    })],
  }),
  P([{ t: "Event guest and access management for Nigerian weddings. Households get invited, reply, receive a pass, and are scanned in at the gate." }]),
  P([
    { t: "6 August 2026", b: true }, { t: "  ·  branch " }, { t: "main", mono: true },
    { t: "  ·  " }, { t: "84 commits", b: true }, { t: "  ·  39 since the last handoff  ·  " },
    { t: "HEAD 29a0a0b", mono: true },
  ]),
  SPACER(),
  Note(
    "Read these three first — they are authoritative, this document is not",
    [
      "HANDOFF.md — why any decision was made. Unchanged and still the source of truth.",
      "STATE.md — the living version of this document, kept current in the repo. If the two disagree, STATE.md is right.",
      "DEPLOY.md — the deployment runbook, every environment variable, the backup and restore drill, and the uptime check.",
    ],
  ),
  SPACER(),
  Note(
    "The one thing to do first",
    [
      "The last Render deploy FAILED and the fix is already pushed. Redeploy from main (29a0a0b) and it will start.",
      "Cause: the platform-admin dashboard added a sixth database role, and the API built every connection pool at startup — so a missing DATABASE_URL_APP_ADMIN stopped the whole process, including the gate. The pool is now created on first use; with the variable unset the API serves everything and only /admin answers 503.",
    ],
    "red",
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// Contents
children.push(
  H1("Contents"),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 1
children.push(
  H1("1. Where the build stands"),
  P("Every suite passes. These numbers are from a full run on 6 August, not from memory."),
  Grid(
    ["Component", "Stack", "Tests"],
    [
      ["apps/api", "Fastify 5 + postgres.js, raw SQL, ~16,300 lines", "357"],
      ["apps/web", "Next.js 16 App Router, 28 routes", "3"],
      ["apps/scanner", "Flutter 3.44 + drift + mobile_scanner", "89"],
      ["packages/checkin-core", "TypeScript, pure — the state machine", "40"],
      ["db/migrations", "18 migrations on spec/schema-v1.sql", "—"],
    ],
    [2400, 4760, 2200],
  ),
  SPACER(),
  P("Both the web app and the Flutter scanner talk to one backend. There is no second API."),
  H2("The headline: it is deployed, and it has met real money and a real gate"),
  P("The previous handoff ended with nothing deployed. That is no longer true."),
  BULLET([{ t: "Vercel serves apps/web. Render serves apps/api as a plain Node service — no container; the Dockerfile was deleted rather than left to rot. Neon holds Postgres 17. Note that migrations 017, 018 and 019 have NOT been applied there yet — see §4." }]),
  BULLET([{ t: "Paystack has been paid, for real. ", b: true }, { t: "A test-mode charge against the deployed API on 2 August: Paystack signed the webhook, the signature verified, and the event moved free/150 → standard/600 with a successful payments row. Forged and unsigned webhooks both get 401 before touching the database." }]),
  BULLET([{ t: "The gate has run offline against the deployed stack. ", b: true }, { t: "Xiaomi, Android 14, aeroplane mode: four scans accepted with no network, verified against signing keys already on the phone. One sync afterwards took the server from 5 rows to 9 — nine distinct client_uuids, no duplicates. Each kept its own scanned_at; the oldest had waited 11 minutes 21 seconds. Reports read scanned_at, so an offline gate does not distort the record it produces." }]),
  BULLET([{ t: "Rehearsed at wedding size. ", b: true }, { t: "400 households and again at 1200. Import 0.75s / 2.1s. Report 0.26s / 0.64s. Scanner bootstrap 84 KB / 250 KB — that one matters, because it is what a phone downloads over mobile data before the gate opens. Per-scan latency flat at 4.9 ms. It found no product bug; both failures were the harness's own." }]),
  SPACER(),
  Note(
    "Still true, and worth repeating",
    ["No feature depends on SMS. Organisers sign up with a phone number and a password and recover with a code; ushers arrive by an invite link over WhatsApp; guest invitations were always WhatsApp deep links. The whole product runs with no messaging spend, which is also the commercial wedge — the nearest competitor resells the WhatsApp Business API at ₦120 a message."],
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 2
children.push(
  H1("2. What was built since the last handoff"),
  P("Thirty-nine commits. Grouped by what they change rather than by date."),

  H2("The product got a name: EventFlow"),
  P('"Working name" was a label admitting there wasn\'t one. The lockup — an EF monogram in a gold rule, EventFlow in Cormorant Garamond, EVENTS, PERFECTED in gold — lives in one component, app/brand.tsx, used by both sidebars, the auth panel, four small card pages and the marketing header. A brand spelled out in eight files eventually gets spelled two ways.'),
  BULLET([{ t: "Two golds, because one cannot do both jobs: #d8b45f on the dark green panels, #8a6a1c on white where the lighter one is unreadable at 10px." }]),
  BULLET([{ t: "The browser tab said “Create Next App” until this session — create-next-app's default had survived as far as the sign-in page." }]),
  BULLET([{ t: "Not changed: hello@gtfd.ng and the gtfd.ng/a9k2mv example link. Naming a product is not owning a domain, and pointing customers at an address nobody controls sends real mail nowhere." }]),

  H2("Three screens rebuilt to the mockups"),
  P([{ t: "Event Settings", b: true }, { t: " — eleven tabs, three columns, the status rail. Seven tabs are real (Event Details, Venue & Time, RSVP, Check-in, QR Passes, Privacy & Visibility, Advanced); four say plainly they are not built. Migration 017 added end_date, timezone, tags, slug, public_page, invitation_only and all_day." }]),
  P([{ t: "Billing & Plans", b: true }, { t: " — the mockup's layout with the product's substance. Its design assumed yearly subscriptions at ₦2,500–₦15,000 with per-tier feature gating; this product sells one payment per event at ₦7,500–₦40,000, nothing renews, and every feature is on every plan. Adopting the mockup's numbers would be a pricing change with revenue attached, not a page. Payment History is real, from the payments table." }]),
  P([{ t: "Sign-in and sign-up", b: true }, { t: " — split screen, Organiser / Admin tabs, live password rule, the reception photograph. The landing page was rebuilt too: hero, product shot, six-card feature strip." }]),

  H2("A super admin, bounded at the database"),
  P("The first thing in this product that deliberately steps outside RLS, so the step is bounded in the schema rather than in the queries."),
  Grid(
    ["app_admin can read", "app_admin cannot touch"],
    [
      ["workspaces, events, event_legs, payments", "invitations, invitation_legs"],
      ["named columns of users", "passes, check_in_events, seating_tables"],
      ["admin_event_size() — counts without reading", "signing_key — permission denied"],
      ["nothing at all, writeably: SELECT only", "any INSERT, UPDATE or DELETE"],
    ],
    [4680, 4680],
  ),
  SPACER(),
  P("admin.test.ts asserts each of those refusals. They are the feature, not a side effect. Access is a flag on the user granted by a script and never by an endpoint, for the same reason reset-password.ts is a script."),

  H2("Four defects found and fixed, each one live"),
  BULLET([{ t: "A phone number is now read the way a Nigerian writes it. ", b: true }, { t: "0803 411 2098 was rejected at every door and reported as “that phone number and password don't match” — a wrong-password error for a formatting difference, on the first screen anybody sees. The rule already existed in csv.ts for guest imports; authentication had its own strict copy. One implementation now, src/phone.ts. This reversed a deliberate, tested decision; the reasoning is in the commit." }]),
  BULLET([{ t: "The backup command did not work. ", b: true }, { t: "backup.ts never read apps/api/.env, so the documented command failed on a machine whose URL was in that file. Nobody had run it, so nobody had found out." }]),
  BULLET([{ t: "An existing account could not get a recovery code. ", b: true }, { t: "POST /auth/recovery-code existed from the start with nothing calling it, so any account not created through /signup had no way back in but a human with database access. Your profile now mints one." }]),
  BULLET([{ t: "Rate limiting had never existed. ", b: true }, { t: "Signup, password login, recovery, OTP and the guest pages are now throttled — see §5 for the part that is easy to get wrong." }]),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 3
children.push(
  H1("3. Decisions that are load-bearing"),
  P("Re-opening any of these means changing several places at once."),
  BULLET([{ t: "The unit is a household.", b: true }, { t: " One row, one allowance, one pass, one QR. A seat is a person." }]),
  BULLET([{ t: "decide() is never reimplemented.", b: true }, { t: " TypeScript in packages/checkin-core, ported once to Dart, with a pinned cross-language token vector. This is why the web scanner is a thin client." }]),
  BULLET([{ t: "No feature depends on SMS.", b: true }, { t: " The phone number is therefore unverified, which is safe here because a number alone grants nothing." }]),
  BULLET([{ t: "Nobody sets anybody else's password.", b: true }, { t: " Support recovery is a script with database access, never an endpoint." }]),
  BULLET([{ t: "Nothing at the gate is blocked over billing.", b: true }, { t: " Walk-ins and overflow are admitted and flagged. A cancelled event is the one refusal that is not about money." }]),
  BULLET([{ t: "Only a transport failure falls back to local data.", b: true }, { t: " A 403 must fail hard — it means the usher was taken off the leg." }]),
  BULLET([{ t: "The public URL token IS the HMAC pass token.", b: true }, { t: " Garbage, forged, revoked and stale all return an identical 404." }]),
  BULLET([{ t: "Passes issue at invitation, never at RSVP.", b: true }, { t: " Many Nigerian guests simply turn up." }]),
  BULLET([{ t: "Attendance is never a stored flag.", b: true }, { t: " It is a SUM over an append-only log, which is what lets two offline phones reconcile." }]),
  BULLET([{ t: "Prices live only in apps/api/src/plans.ts,", b: true }, { t: " and only a signed webhook upgrades a plan." }]),
  SPACER(),
  H2("Added this month"),
  BULLET([{ t: "A phone number is read the way it is written, everywhere.", b: true }, { t: " 0803…, 803…, 234803… and +234… all reach the same E.164 row through src/phone.ts. Known cost: a non-Nigerian local number becomes a Nigerian one, so international numbers must carry their country code." }]),
  BULLET([{ t: "The platform admin sees the business, never a guest list.", b: true }, { t: " Support screens that must show a real guest list would be a separate, explicit grant — and should arrive with the audit log the sidebar already has a place for." }]),
  BULLET([{ t: "The billing mockup does not describe this product, and the product won.", b: true }, { t: " One payment per event, nothing renews, every feature on every plan. The public pricing page already says so." }]),
  BULLET([{ t: "Marketing claims must be true.", b: true }, { t: " The landing-page mockup carried “Trusted by 5,000+ event organizers worldwide”, a five-star rating and six named client logos. There are no customers yet. Those slots carry what is true instead — the price, and that the gate works with no signal. The layout is built and waiting for a real customer willing to be named." }]),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 4
children.push(
  H1("4. Deployment, accounts and credentials"),
  H2("What is where"),
  Grid(
    ["Piece", "Host", "State"],
    [
      ["apps/web", "Vercel", "Live. Root directory apps/web."],
      ["apps/api", "Render", "Deployed, but the last deploy FAILED — see below."],
      ["Postgres 17", "Neon", "Live, us-east-1. Migrations 017–019 not applied yet — see below."],
      ["Repo", "github.com/uksahaby/guest", "main, in sync at 29a0a0b."],
    ],
    [2200, 2400, 4760],
  ),
  SPACER(),
  Note(
    "Render: redeploy from main and it will start",
    [
      "The failure was Missing DATABASE_URL_APP_ADMIN. Production must set a URL for every RLS role. Fixed in 29a0a0b by making that one pool lazy.",
      "Verified against a production-mode boot with the five original roles set and the sixth absent: /health {\"ok\":true}, guest route 404, scanner 401, login 401, /admin/overview 503 platform_not_configured.",
    ],
    "red",
  ),
  SPACER(),
  Note(
    "Neon: migrations 017, 018 and 019 have NOT been applied there",
    [
      "They were applied to the local demo database only. Until they are run against Neon, the deployed Event Settings screen, the public event page and the admin dashboard will fail.",
      "DATABASE_URL=\"<superuser url>\" npm run migrate --workspace api  — then check --status. Take a backup first; the command is in §6.",
    ],
    "amber",
  ),
  SPACER(),
  H2("Environment variables that are easy to miss"),
  Grid(
    ["Variable", "Notes"],
    [
      ["TRUST_PROXY", "Effectively required. Unset, every per-IP rate limit shares one bucket for the whole internet, and the API warns about it at startup."],
      ["DATABASE_URL_APP_ADMIN", "Optional. Only the admin dashboard needs it. Unset, everything else works."],
      ["ERROR_WEBHOOK_URL", "Optional. Unset, the only record of a fault is the log."],
      ["API_HEALTH_URL", "A GitHub repository variable, not an app one. Without it the uptime workflow does nothing."],
      ["tsx", "Not a variable — a warning. It must stay in dependencies, not devDependencies, or the service dies with tsx: not found."],
    ],
    [2900, 6460],
  ),
  SPACER(),
  H2("Accounts that exist"),
  P([{ t: "On Neon (the deployed database): ", b: true }, { t: "23 users. Yours is " }, { t: "+2348069293636", mono: true }, { t: " (Ukashah Sahabi), which has a password and a recovery code. It is not a platform admin yet." }]),
  // The two demo passwords that used to be spelled out here are deliberately
  // not in this file: it lives in a PUBLIC repository, and a password in git
  // history cannot be taken back out. They are local-demo-only accounts, but
  // the risk that matters is reuse, not this database. Reset either with
  // scripts/reset-password.ts if the value has been lost.
  P([{ t: "On the local demo database only: ", b: true }, { t: "Khalid Salami " }, { t: "+2348030000001", mono: true }, { t: ", and Zakia Waziri " }, { t: "+2348037641886", mono: true }, { t: " who is the platform admin. Passwords are not written down here — reset with scripts/reset-password.ts. Neither account exists on Neon." }]),
  P([{ t: "To make yourself an admin on the deployed system, after migration 019 has run there:" }]),
  Code([
    "npx tsx apps/api/scripts/platform-admin.ts +2348069293636 \"Ukashah Sahabi\"",
  ]),
  SPACER(),
  Note(
    "Neon has test fixtures in it",
    ["Eight accounts named “Folake Adeyemi” and one “Not The Usher” — those are testutil.ts fixture names, so something pointed a test run at the production database. testdb.ts guards against exactly this. Harmless now; the same accident once a customer's guest list is there is a different conversation. Worth finding what ran."],
    "amber",
  ),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 5
children.push(
  H1("5. Traps that will bite you"),
  P("Every one of these was hit and paid for. They are the fastest way to lose a day."),

  H2("Postgres and RLS"),
  BULLET([{ t: "RLS is load-bearing.", b: true }, { t: " The API connects as app_rw / app_usher / app_public / app_verify / app_billing / app_admin — never postgres. Superusers bypass every policy." }]),
  BULLET([{ t: "Grants on events are per-column.", b: true }, { t: " A new column is invisible to every role until named in a grant, including app_rw, and it fails as “permission denied for table events” pointing nowhere near the cause. Hit by migrations 008, 011, 013, 017 and 018." }]),
  BULLET([{ t: "ON CONFLICT DO UPDATE needs UPDATE rights.", b: true }, { t: " app_usher holds insert and nothing more, so walk-in replay uses DO NOTHING and reads the row back." }]),
  BULLET([{ t: "The append-only log fights deletion by design.", b: true }, { t: " Used gates are closed, not deleted, because the FK's ON DELETE SET NULL is itself an UPDATE." }]),

  H2("The API"),
  BULLET([{ t: "Never reply.send() inside a transaction on a write path.", b: true }, { t: " The response goes out before the COMMIT. Two real bugs so far; the second surfaced as a flaky test, one failure in six, which was a finding rather than noise." }]),
  BULLET([{ t: "Restart the API after adding a route or changing a payload.", b: true }, { t: " Hit twice more this month — “Call manager” did nothing, and /e/<slug> 404'd in the browser while its tests were green. Curl the endpoint before debugging the client." }]),
  BULLET([{ t: "A new database role must not be required at startup.", b: true }, { t: " Every pool is built at module load, and a missing URL throws. That is right for the roles without which there is no product, and wrong for anything optional — it turned a dashboard into a hard dependency of the gate and broke a deploy. Lazy is the fix." }]),

  H2("Rate limiting, and the address it counts against"),
  BULLET([{ t: "req.ip is a lie until TRUST_PROXY is set.", b: true }, { t: " Nothing reaches the API directly: the platform's router is in front, and the web app makes every guest-facing call server-side. Unset, all traffic shares one bucket and the first burst locks out everybody including the couple. apps/web forwards X-Forwarded-For; the API believes it only when TRUST_PROXY says so. Both halves are needed and neither is visible when wrong — limiting still works, it just fires on the wrong person." }]),
  BULLET([{ t: "Per-IP limits cannot be tight here.", b: true }, { t: " Nigerian carriers NAT whole cities behind a few addresses. The tight limits are per phone number — 10 failed sign-ins per 15 minutes, 5 recovery attempts per hour — and they count failures only, so a success clears the count." }]),

  H2("Next.js"),
  BULLET([{ t: "A server component cannot import plain data from a “use client” module.", b: true }, { t: " Only components survive that boundary; an array comes back undefined and the page 500s. Move shared data to its own module." }]),
  BULLET([{ t: "A form inside a form is dropped silently by the browser.", b: true }, { t: " It renders, hydrates with a warning, and then posts to the wrong action. Use the form=\"…\" attribute to place an input in a form it is not nested inside." }]),
  BULLET([{ t: "Route CSS is global.", b: true }, { t: " Scope every selector, and put anything shared by more than one surface in globals.css — the brand lockup rendered as one squashed line on the marketing page because its CSS lived in a file that page does not load." }]),
  BULLET([{ t: "Two dev servers on one checkout fight over .next.", b: true }, { t: " Set NEXT_DIST_DIR. The symptom is a page rendering current markup while running a stale bundle." }]),

  H2("Devices, tooling and Windows"),
  BULLET([{ t: "A paused Flutter app returns stale screenshots.", b: true }, { t: " It reads exactly like a hang. Wake the device before believing one." }]),
  BULLET([{ t: "The adb reverse tunnel dies quietly.", b: true }, { t: " adb reverse --list still shows it while nothing gets through." }]),
  BULLET([{ t: "cmd.exe does not expand globs in npm scripts,", b: true }, { t: " so test files are listed explicitly in package.json — a new test file that is not added there never runs." }]),
  BULLET([{ t: "psql output on Windows carries a trailing carriage return.", b: true }, { t: " Piping an id straight into a query gives “invalid input syntax for type uuid”. Strip \\r, not just \\n." }]),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 6
children.push(
  H1("6. What is left to do"),
  H2("Before one real wedding"),
  Grid(
    ["#", "What", "Who", "Effort"],
    [
      ["1", "Redeploy the API on Render from 29a0a0b. The fix is already pushed.", "you", "minutes"],
      ["2", "Apply migrations 017, 018 and 019 to Neon, after a backup.", "me, on your say-so", "minutes"],
      ["3", "Set TRUST_PROXY on Render, or the rate limits protect nobody.", "you", "minutes"],
      ["4", "A backup that is a policy: a schedule, and a copy that is not on one laptop. Check Neon's history-retention window.", "you + me", "1–2 hrs"],
      ["5", "Event creation is one thin form against a five-step design.", "me", "1 day"],
      ["6", "A full rehearsal with a real guest list and real WhatsApp sends.", "you + me", "a day"],
    ],
    [560, 5200, 1900, 1700],
  ),
  SPACER(),
  H2("Before charging strangers"),
  BULLET("The four unbuilt Event Settings tabs — Branding, Invitation Settings, Notifications, Integrations."),
  BULLET("The eleven unbuilt admin sections, of which Audit Logs matters most: an admin reading a customer's business should leave a trace, and that should exist before anyone but you is an administrator."),
  BULLET("Invoices as a document, and email as both a delivery channel and a second recovery path."),
  BULLET("Undo and a recent list in the web scanner. The app has both; the browser has neither."),
  BULLET("Guest-page accessibility and performance pass — never done."),
  BULLET("Paystack live keys and the business account behind them. Test mode is proven; live is not."),
  BULLET("The amount-mismatch webhook path, which marks a payment failed rather than applying it. Paystack's test flow will not produce it on its own."),
  BULLET("Scanner polish: back-press exits a leg with no confirm; the app installs under the label “scanner”; no error path when the camera is denied."),
  BULLET("Revisit the unverified phone number — email verification before scale."),
  SPACER(),
  H2("Deliberately deferred — not gaps"),
  P("Multi-leg UI, multi-day sessions, re-entry and check-out, cross-device undo, the paid WhatsApp API add-on, tiers above 2,500 people. The handoff parked these on purpose."),
  H2("Only the founder can do"),
  P("The domain, and a NIPO trademark search in Classes 9 and 42 — “EventFlow” is a common name in event software, and CAC registration does not protect a brand. Then the weddings-first versus access-control-first positioning call, Paystack live keys, and finding the first real couple."),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 7
children.push(
  H1("7. Commands you will need"),
  P("From the repository root unless stated."),
  H2("Everyday"),
  Code([
    "npm test --workspace api            # 357",
    "npm test --workspace checkin-core   # 40",
    "npm test --workspace web            # 3",
    "cd apps/scanner && flutter test     # 89",
  ]),
  SPACER(),
  H2("Migrations"),
  Code([
    "DATABASE_URL=\"<superuser url>\" npm run migrate --workspace api",
    "npm run migrate --workspace api -- --status",
  ]),
  SPACER(),
  H2("Backups — take one before touching Neon"),
  Code([
    "npm run backup --workspace api                  # writes and verifies",
    "npm run backup --workspace api -- --list FILE   # what is inside one",
    "npm run backup --workspace api -- --prune 30",
  ]),
  P("Restoring a Neon dump anywhere else always ends “errors ignored on restore: 2” — both are Neon's own neon_superuser and cloud_admin roles, which no other Postgres has. Any other error in that count is not benign, and the five application roles failing is the one that looks like success."),
  SPACER(),
  H2("Support and administration"),
  Code([
    "npx tsx apps/api/scripts/reset-password.ts +234…  \"a chosen password\"",
    "npx tsx apps/api/scripts/platform-admin.ts                 # list admins",
    "npx tsx apps/api/scripts/platform-admin.ts +234… \"Name\"    # grant",
    "npx tsx apps/api/scripts/platform-admin.ts +234… --revoke",
  ]),
  SPACER(),
  H2("Running the demo data locally"),
  P("The rich demo — Khalid Salami, Ahmed & Aisha's Wedding, 240 households, 743 people, 13 tables — lives in the local guest_dash_demo database, not on Neon. To run against it, point every role at it and use ports that do not collide with anything else:"),
  Code([
    "DATABASE_URL=postgres://postgres@localhost:5432/guest_dash_demo \\",
    "DATABASE_URL_APP_RW=postgres://app_rw:app_rw_dev_only@localhost:5432/guest_dash_demo \\",
    "  (…and the same for _USHER, _PUBLIC, _VERIFY, _BILLING, _ADMIN) \\",
    "JWT_SECRET=local-demo-secret PORT=3005 ALLOW_SMS_LOG_SENDER=true \\",
    "  npx tsx apps/api/src/server.ts",
    "",
    "cd apps/web && API_URL=http://localhost:3005 NEXT_DIST_DIR=.next-demo \\",
    "  npx next dev -p 3010",
  ]),
  SPACER(),
  H2("The scanner on a USB phone"),
  Code([
    "adb reverse tcp:3001 tcp:3001",
    "cd apps/scanner && flutter run --dart-define=API_URL=http://localhost:3001",
  ]),
  new Paragraph({ children: [new PageBreak()] }),
);

// ---------------------------------------------------------------- 8
children.push(
  H1("8. Commits since the last handoff"),
  P("Newest first. Every message explains why, not just what."),
  Grid(
    ["Commit", "Subject"],
    [
      ["29a0a0b", "Stop the admin dashboard from being able to take the gate down"],
      ["301c4f8", "Rebuild the landing page, minus the customers we do not have"],
      ["31252cb", "Give the thing a name: EventFlow"],
      ["43f645e", "Rebuild sign-in and sign-up, with a real admin door"],
      ["44aa830", "Let us see the business without seeing anybody's wedding"],
      ["0b385cb", "Read a phone number the way a Nigerian writes it"],
      ["0b5f0d2", "Let an organiser get a recovery code without signing up again"],
      ["8f9268a", "Build Billing & Plans, without inventing a price"],
      ["049d416", "Make the backup command work, and prove a restore from Neon"],
      ["9de7081", "Say so when the rate limits are pointed at the wrong address"],
      ["f7a084d", "Give the event link somewhere to land"],
      ["7ee1a86", "Build the event settings screen, to the mockup"],
      ["0f7fdb2", "Build gates and teams, with incidents that get recorded"],
      ["ddf81eb", "Build the reports screen, and keep a real export history"],
      ["e6e69b5", "Build the check-in screen"],
      ["b6eebcb", "Build the QR passes screen"],
      ["d9b783c", "Build tables and seating, with a draggable floor plan"],
      ["ae991a8", "Add the profile menu, photo uploads, and stop a legend spilling"],
      ["0b9b7ad", "Stand the response rate beside both RSVP rows"],
      ["8e0e761", "Ask guests how many are children, and correct two layout faults"],
      ["7132c4e", "Build RSVP management, to the mockup"],
      ["2c1b504", "Build the invitations screen"],
      ["42db151", "Build the guest list, and pin the sidebar"],
      ["cacd6ed", "Build the event overview"],
      ["5bf6ea6", "Build the organiser dashboard"],
      ["316b88b", "Payments have now met real Paystack"],
      ["adb45a1", "The cues have been heard"],
      ["e6535c8", "Record the offline drill, on hardware, against the real stack"],
      ["433f0d6", "Rehearse at wedding size"],
      ["7e58172", "Ask the API whether it is alive, from somewhere else"],
      ["903088a", "Tell someone when it breaks"],
      ["bdb845e", "Back the database up, and prove a restore brings it back"],
      ["3c92e34", "Give the gate a voice"],
      ["c48e92f", "Hand the gate back after admitting from the count picker"],
      ["2faf8c0", "Let ushers sign in to the scanner app with their invite link"],
      ["56625ca", "Pin Node to 22 with a .node-version file"],
      ["f6cbfbe", "Delete the Dockerfile"],
      ["971f3a0", "Deploy the API as a Node service, not a container"],
      ["84db89c", "Throttle every door that opens onto the internet"],
    ].map((r) => { r.mono = true; return r; }),
    [1500, 7860],
  ),
  SPACER(),
  Note(
    "Two caveats worth stating rather than burying",
    [
      "Software estimates are unreliable in one direction only.",
      "Every “done” here means tested, and where §1 says proven on hardware it means watched working on a real phone against the deployed stack. What has still never happened: a real guest list, a real couple, and a paying customer. The product now looks finished on every screen, and those three facts have not moved.",
    ],
  ),
);

// ---------- assemble ------------------------------------------------------

const doc = new Document({
  creator: "EventFlow",
  title: "EventFlow — Continuation Handoff, August",
  description: "State of the build, what is deployed, and what is left.",
  numbering: {
    config: [
      {
        reference: "dots",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 200 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 200 } } } },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 21, color: INK } },
      heading1: { run: { font: "Georgia", size: 34, bold: false, color: GREEN },
        paragraph: { spacing: { before: 380, after: 140 } } },
      heading2: { run: { font: "Georgia", size: 26, bold: false, color: INK },
        paragraph: { spacing: { before: 260, after: 100 } } },
      heading3: { run: { font: "Calibri", size: 22, bold: true, color: GREEN },
        paragraph: { spacing: { before: 200, after: 80 } } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "Guest-Platform-Handoff-August.docx";
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out} — ${(buf.length / 1024).toFixed(0)} KB`);
});
