import type { Metadata } from "next";
import Link from "next/link";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./marketing.css";
import { Brand } from "@/app/brand";

/**
 * The marketing homepage — ported from design/mockups/public-website.html.
 * Fully static, zero client JS: the FAQ runs on <details>, everything else
 * is copy. The copy is the product's voice; changes belong in design
 * review, not drive-by edits.
 */

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Everyone you invited. Nobody you didn't.",
  description:
    "Send your invitations on WhatsApp, let each family reply, and check every guest in at the gate with a scan. For Nigerian weddings and everything larger.",
};


/**
 * The six cards under the hero. Every one is a thing this product already
 * does — the mockup's six happen to describe it accurately, which is why
 * they are here unchanged rather than trimmed.
 */
const FEATURES = [
  {
    title: "Guest management",
    body: "One row per household, not per person. Import a spreadsheet and keep the numbers straight.",
    icon: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-1a4 4 0 0 0-3-3.9",
  },
  {
    title: "Invitations on WhatsApp",
    body: "Each family gets their own link, replies on it, and keeps their pass in the same chat.",
    icon: "M3 6h18v12H3zM3 7l9 6 9-6",
  },
  {
    title: "QR passes & check-in",
    body: "One pass per household, scanned at the gate — and it verifies with no signal at all.",
    icon: "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9 9h2v2H9zM13 13h2v2h-2z",
  },
  {
    title: "Tables & seating",
    body: "Lay out the room, seat households, and see who is still unseated before the day.",
    icon: "M3 10h18M6 10v10M18 10v10M8 6h8v4H8z",
  },
  {
    title: "Reports afterwards",
    body: "Who came, who did not, when they arrived and what happened at every gate.",
    icon: "M5 20V10m7 10V4m7 16v-7",
  },
  {
    title: "Built to be private",
    body: "Row-level security in the database, so one couple's guest list can never reach another.",
    icon: "M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z",
  },
];

/**
 * The product shot from the mockup, built rather than screenshotted: a
 * still of the dashboard beside the pass a guest holds.
 *
 * Markup and CSS, not an image, for three reasons. It stays sharp on any
 * screen, it costs a few kilobytes instead of a few hundred, and a
 * screenshot goes stale the first time the dashboard changes while this
 * cannot. The figures are illustrative — a product shot with sample data,
 * which is what the mockup shows.
 *
 * aria-hidden throughout: it is a picture of software, and reading its
 * numbers aloud tells a screen reader user nothing the hero has not
 * already said in words.
 */
function ProductShot() {
  // The half-hour arrival curve the check-in screen actually draws, shaped
  // the way a real reception goes: a trickle, a rush after the ceremony,
  // then a long tail.
  const curve = [
    3, 4, 6, 5, 9, 14, 12, 18, 26, 34, 30, 44, 58, 52, 71, 88, 79, 96, 84,
    68, 55, 47, 38, 31, 26, 21, 17, 14, 11, 8, 6, 4,
  ];
  const W = 320;
  const H = 96;
  const max = Math.max(...curve);
  const pts = curve.map((v, i) => [
    (i / (curve.length - 1)) * W,
    H - (v / max) * (H - 8) - 2,
  ]);
  const line = pts.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ");
  const area =
    `M0,${H} ` +
    pts.map(([x, y]) => `L${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ") +
    ` L${W},${H} Z`;

  const arrivals = [
    { name: "Mustafa Bello", seat: "Table 7", at: "4:15 PM" },
    { name: "Zainab Bello", seat: "Table 7", at: "4:20 PM" },
    { name: "Aisha Ibrahim", seat: "Table 12", at: "4:31 PM" },
    { name: "Ibrahim Khan", seat: "Table 3", at: "4:35 PM" },
  ];

  const NAV = [
    "Dashboard", "Events", "Guests", "Invitations", "RSVPs",
    "Tables & Seating", "QR Passes", "Check-in", "Reports", "Settings",
  ];

  const STATS = [
    { k: "Total guests", v: "682", n: "240 households" },
    { k: "RSVP confirmed", v: "412", n: "60.4% of total" },
    { k: "Checked in", v: "245", n: "35.9% of total" },
    { k: "Tables occupied", v: "90%", n: "12 of 12 tables" },
  ];

  return (
    <div className="shot" aria-hidden="true">
      <div className="shot-app">
        <div className="shot-side">
          <div className="shot-brandrow">
            <span className="shot-mark">EF</span>
            <span className="shot-wordmark serif">EventFlow</span>
          </div>
          {NAV.map((l, i) => (
            <div className={`shot-nav${i === 0 ? " on" : ""}`} key={l}>
              <span className="shot-dot" />
              {l}
            </div>
          ))}
        </div>

        <div className="shot-main">
          <div className="shot-top">
            <div>
              <strong>Dashboard</strong>
              <small>Welcome back, Ukashah — here is what is happening.</small>
            </div>
            <div className="shot-me">
              <span className="shot-avatar">US</span>
              <span>
                <b>Ukashah Sahabi</b>
                <i>Organiser</i>
              </span>
            </div>
          </div>

          <div className="shot-stats">
            {STATS.map((c) => (
              <div className="shot-stat" key={c.k}>
                <small>{c.k}</small>
                <b>{c.v}</b>
                <i>{c.n}</i>
              </div>
            ))}
          </div>

          <div className="shot-lower">
            <div className="shot-chart">
              <div className="shot-chart-head">
                <strong>Check-in activity</strong>
                <span className="shot-chip">By half hour</span>
              </div>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="shot-svg"
              >
                <path className="shot-area" d={area} />
                <polyline className="shot-line" points={line} />
              </svg>
              <div className="shot-axis">
                <span>2 PM</span>
                <span>4 PM</span>
                <span>6 PM</span>
                <span>8 PM</span>
              </div>
            </div>

            <div className="shot-feed">
              <strong>Recent check-ins</strong>
              {arrivals.map((a) => (
                <div className="shot-arrival" key={a.name}>
                  <span className="shot-avatar sm">
                    {a.name.split(" ").map((w) => w[0]).join("")}
                  </span>
                  <span>
                    <b>{a.name}</b>
                    <i>
                      {a.seat} · {a.at}
                    </i>
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shot-tick"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8.5 12 2.5 2.5 4.5-5" />
                  </svg>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The guest's own pass, overlapping the dashboard as the mockup has it. */}
      <div className="shot-phone">
        <div className="shot-phone-in">
          <div className="shot-phone-bar">Your QR pass</div>
          <div className="shot-pass">
            <small>Ahmed &amp; Aisha&rsquo;s</small>
            <b className="serif">24 Aug 2026</b>
            <span className="shot-qr">
              <QrPattern />
            </span>
            <b>Mustafa Bello</b>
            <small>Table 7 · Admits 4</small>
            <span className="shot-badge">Confirmed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A QR-shaped pattern: three finder squares and a deterministic body.
 *
 * Deliberately not a real code. A scannable QR on a public marketing page
 * is an invitation to point a phone at it, and whatever it resolved to
 * would be either a dead link or somebody's actual pass.
 */
function QrPattern() {
  const N = 21;
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const inFinder =
        (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      let on = false;
      if (inFinder) {
        // Local coordinates inside whichever 7x7 finder this is.
        const fx = x > 13 ? x - 14 : x;
        const fy = y > 13 ? y - 14 : y;
        const edge = fx === 0 || fx === 6 || fy === 0 || fy === 6;
        const core = fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4;
        on = edge || core;
      } else {
        on = (x * 7 + y * 13 + ((x * y) % 5)) % 3 === 0;
      }
      if (on) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
      }
    }
  }
  return (
    <svg viewBox="0 0 21 21" shapeRendering="crispEdges">
      {cells}
    </svg>
  );
}

export default function Home() {
  return (
    <div className={`mkt ${cormorant.variable} ${inter.variable}`}>
      <nav className="nav">
        <div className="wrap">
          <Link className="brand" href="/">
            <Brand tone="light" size="sm" />
          </Link>
          <div className="sp" />
          {/* The mockup's Features / Solutions / Resources dropdowns want
              pages that do not exist. These go to the sections that do —
              a menu that opens onto nothing is worse than a short menu. */}
          <a className="lnk hideS" href="#features">Features</a>
          <a className="lnk hideS" href="#how">How it works</a>
          <a className="lnk hideS" href="#price">Pricing</a>
          <a className="lnk hideS" href="#inst">For organisations</a>
          <Link className="lnk" href="/login">Log in</Link>
          {/* Where the mockup has "Book a Demo". There is no booking
              system and no recorded demo, so this opens a real
              conversation instead of pretending to schedule one. */}
          <a className="btn ghost-g hideS" href="mailto:hello@gtfd.ng?subject=EventFlow%20%E2%80%94%20can%20we%20talk%3F">
            Talk to us
          </a>
          <Link className="btn pri" href="/signup">Get started free</Link>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header className="hero2">
        <div className="wrap hero2-grid">
          <div className="hero2-copy">
            <span className="pill-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l1.9 4.6L19 9.2l-3.6 3.4.8 5-4.2-2.4L7.8 17.6l.8-5L5 9.2l5.1-1.6z" />
              </svg>
              All-in-one event management platform
            </span>

            <h1 className="serif hero2-h1">
              Plan. Manage. Perfect
              <span className="hero2-accent">
                Every Event.
                {/* The hand-drawn underline from the mockup. */}
                <svg className="swoosh" viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M2 9c48-6 108-8 158-6 42 2 82 5 138 2" />
                </svg>
              </span>
            </h1>

            <p className="lead">
              From invitations to check-ins and seating, EventFlow helps you
              manage every detail so you can focus on the day itself.
            </p>

            <div className="cta">
              <Link className="btn pri lg" href="/signup">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 8h18M7 3v4m10-4v4M4 5h16v16H4z" />
                </svg>
                Create your first event
              </Link>
              <a className="btn outline lg" href="#how">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" />
                </svg>
                See how it works
              </a>
            </div>

            {/*
              The mockup puts "Trusted by 5,000+ event organizers worldwide"
              here, over four faces and five gold stars, and a wall of six
              named client logos below the fold.

              None of it is true. There are no customers yet, no reviews to
              average into stars, and those six companies are not ours —
              they are a designer's placeholder text. A page that invents
              them is lying to the one person it most needs to trust it, and
              the first real customer who finds out is the one who tells
              everybody.

              So the same slot carries the things that ARE true, which are
              not nothing: the price, and the fact that the gate works with
              no signal at all.
            */}
            <ul className="hero2-proof">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
                </svg>
                First 150 guests free
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
                </svg>
                No card needed
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
                </svg>
                The gate works with no signal
              </li>
            </ul>
          </div>

          <ProductShot />
        </div>
      </header>

      {/* ================= FEATURE STRIP ================= */}
      <section id="features" className="featstrip">
        <div className="wrap">
          <div className="featgrid">
            {FEATURES.map((f) => (
              <div className="featcard" key={f.title}>
                <span className="featicon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={f.icon} />
                  </svg>
                </span>
                <strong>{f.title}</strong>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= PROBLEM ================= */}
      <section>
        <div className="wrap">
          <div className="kicker">The gate on the day</div>
          <h2 className="big serif">
            You planned for 400.
            <br />
            600 turned up.
          </h2>
          <p className="sublede">
            Nigerian weddings are generous by nature. The trouble is that
            generosity meets a caterer who counted plates, and a hall with a
            fire limit.
          </p>

          <div className="probs">
            <div className="prob">
              <div className="n">01</div>
              <h3>The list lives in four places</h3>
              <p>
                A WhatsApp group with your sisters, a notebook, an old
                spreadsheet, and your mother&rsquo;s memory. Nobody knows the
                real number.
              </p>
            </div>
            <div className="prob">
              <div className="n">02</div>
              <h3>Printed cards get passed around</h3>
              <p>
                One card, one family — in theory. In practice it&rsquo;s
                photographed and forwarded, and you find out at the door.
              </p>
            </div>
            <div className="prob">
              <div className="n">03</div>
              <h3>Your uncle is on the gate with a biro</h3>
              <p>
                Searching 400 names on paper while a queue builds behind,
                arguing with people he half recognises.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= HOW ================= */}
      <section id="how" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="kicker">How it works</div>
          <h2 className="big serif">Four things, in order</h2>

          <div className="steps">
            <div className="stp">
              <div className="n">1</div>
              <h3>Build your list by family</h3>
              <p>
                Not 512 names — 186 invitations. &ldquo;Mr &amp; Mrs Adeyemi,
                admits 4.&rdquo; Import the spreadsheet you already have, or
                type them in. It&rsquo;s free to build a list of any size.
              </p>
            </div>
            <div className="stp">
              <div className="n">2</div>
              <h3>Send on WhatsApp</h3>
              <p>
                Each family gets their own link, sent from your own WhatsApp.
                They open it, see a proper invitation, and tell you how many
                are coming.
              </p>
            </div>
            <div className="stp">
              <div className="n">3</div>
              <h3>Everyone gets a pass</h3>
              <p>
                A code on their phone, tied to that family and that wedding
                alone. Screenshots are fine. Nobody downloads an app.
              </p>
            </div>
            <div className="stp">
              <div className="n">4</div>
              <h3>Scan them in</h3>
              <p>
                Your ushers scan with their own phones. You watch the numbers
                climb from wherever you&rsquo;re standing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= SIGNATURE: THE GATE ================= */}
      <section className="gate">
        <div className="wrap">
          <div className="kicker">The part nobody else gets right</div>
          <h2 className="big serif">
            A family of four
            <br />
            doesn&rsquo;t arrive at once
          </h2>
          <p className="sublede">
            Most systems give every person a separate code, then treat a second
            scan as fraud. Ours knows the Adeyemis were invited for four, three
            have walked in, and one is still parking.
          </p>

          <div className="gatecard">
            <div className="gbar" />
            <div className="gbody">
              <div className="gstat">
                <span className="tick">✓</span>3 of 4 admitted
              </div>
              <div className="gwho">Mr &amp; Mrs Adeyemi</div>
              <div className="gmeta">Groom&rsquo;s Family · Table 12</div>
              <div className="gpips">
                <span className="gp in" />
                <span className="gp in" />
                <span className="gp in" />
                <span className="gp" />
                <b>
                  1 still to come <span>· pass stays active</span>
                </b>
              </div>
            </div>
          </div>

          <div className="gpoints">
            <div className="gpt">
              <h3>No plus-one admin</h3>
              <p>
                You never tick a box marked &ldquo;plus one&rdquo;. You write
                how many the invitation admits, and that&rsquo;s the whole
                idea.
              </p>
            </div>
            <div className="gpt">
              <h3>Extra cousin at the gate?</h3>
              <p>
                Your usher lets them in and you see it happen on your phone.
                Nobody is turned away in front of the family.
              </p>
            </div>
            <div className="gpt">
              <h3>Every scan recorded</h3>
              <p>
                Who came, when, through which gate, and who was turned away.
                You get the whole story the next morning.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FEATURES ================= */}
      <section>
        <div className="wrap">
          <div className="rows">
            <div className="frow">
              <div>
                <h3>Sent where your guests already are</h3>
                <p>
                  No email addresses to chase. Each family&rsquo;s invitation
                  opens in your own WhatsApp with the message written and their
                  personal link attached — you just press send.
                </p>
              </div>
              <div className="chatbox">
                {`Mr & Mrs Adeyemi — you're invited to the wedding of Ahmed & Aisha on Saturday 12 December at Oriental Hotel, Victoria Island.

Your invitation admits 4.

Open it here to reply and get your entry pass:
gtfd.ng/a9k2mv`}
              </div>
            </div>

            <div className="frow">
              <div>
                <h3>The hall has no network. It doesn&rsquo;t matter.</h3>
                <p>
                  Your ushers download the guest list before doors open.
                  Scanning carries on with no signal at all, and everything
                  syncs the moment a phone finds the network again.
                </p>
              </div>
              <div className="offbox">
                <div className="offhead">Main Gate · Musa</div>
                <div className="offrow">
                  <span className="t">✓</span>Guest list downloaded
                  <span className="r">512</span>
                </div>
                <div className="offrow">
                  <span className="t">✓</span>Entry keys stored
                  <span className="r">Ready</span>
                </div>
                <div className="offrow">
                  <span className="t w">!</span>No signal — still scanning
                  <span className="r">7 queued</span>
                </div>
              </div>
            </div>

            <div className="frow">
              <div>
                <h3>Your guests never install anything</h3>
                <p>
                  They tap a link. It opens in whatever browser their phone
                  already has — old iPhone, cheap Android, doesn&rsquo;t
                  matter. They reply, they save the pass, they show it at the
                  gate.
                </p>
              </div>
              <div>
                <p>
                  And they never pay a naira. Your guests should not be asked
                  for money to attend your wedding, so there is no charge to
                  them at any point.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PRICING ================= */}
      <section id="price" className="pricing-band">
        <div className="wrap">
          <div className="kicker">Pricing</div>
          <h2 className="big serif">One payment, for your wedding</h2>
          <p className="sublede">
            Not a subscription. Nothing renews, nothing is charged again, and
            you can build your whole guest list before you decide.
          </p>

          <div className="ptable narrow">
            <div className="prow">
              <div className="cap">
                <b>Free</b>
                <span>Try the whole thing</span>
              </div>
              <div className="head">150 guests</div>
              <div className="amt">₦0</div>
            </div>
            <div className="prow">
              <div className="cap">
                <b>Small</b>
                <span>An intimate wedding</span>
              </div>
              <div className="head">300 guests</div>
              <div className="amt">₦7,500</div>
            </div>
            <div className="prow hl">
              <div className="cap">
                <b>Standard</b>
                <span>Most Nigerian weddings</span>
              </div>
              <div className="head">600 guests</div>
              <div className="amt">₦15,000</div>
            </div>
            <div className="prow">
              <div className="cap">
                <b>Large</b>
                <span>A full hall</span>
              </div>
              <div className="head">1,200 guests</div>
              <div className="amt">₦25,000</div>
            </div>
            <div className="prow">
              <div className="cap">
                <b>Grand</b>
                <span>The whole town is coming</span>
              </div>
              <div className="head">2,500 guests</div>
              <div className="amt">₦40,000</div>
            </div>
          </div>

          <p className="pnote narrow">
            Roughly the cost of two or three plates of food, for the one part
            of the day where a mistake is visible to everyone.
          </p>

          <div className="incl">
            <span>Every feature on every plan</span>
            <span>Unlimited ushers</span>
            <span>Unlimited gates</span>
            <span>Offline check-in</span>
            <span>Tables &amp; seating</span>
            <span>Full report afterwards</span>
          </div>

          <p className="pnote narrow dim">
            Planning weddings for a living? There&rsquo;s a monthly plan for
            that — but if you run fewer than about sixteen events a year,
            paying per event is cheaper and we&rsquo;d rather you did that.
          </p>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section>
        <div className="wrap narrow">
          <div className="kicker">Questions</div>
          <h2 className="big serif">The ones people ask</h2>

          <div className="faq">
            <details open>
              <summary>What if a guest turns up without their phone?</summary>
              <p>
                Your usher searches their name and checks them in by hand. It
                takes a few seconds and it&rsquo;s recorded the same way as a
                scan. Dead batteries are the most ordinary thing that happens
                at a wedding — it&rsquo;s a normal part of the app, not an
                emergency.
              </p>
            </details>
            <details>
              <summary>
                Someone forwarded their pass to a friend. What happens?
              </summary>
              <p>
                The first family through gets in. When the pass is presented
                again with none of the invitation left, the usher sees that
                it&rsquo;s already been fully used, along with the time and
                which gate. Whoever is holding it can be turned away or waved
                through — that&rsquo;s your call, not the software&rsquo;s.
              </p>
            </details>
            <details>
              <summary>Do I have to name every single guest?</summary>
              <p>
                No. &ldquo;The Okafor Family, admits 6&rdquo; is a complete
                entry. Name the individuals only if you want table cards or a
                record of exactly who came.
              </p>
            </details>
            <details>
              <summary>Can I try it before paying?</summary>
              <p>
                Yes, and properly. Build your entire guest list free —
                there&rsquo;s no cap on that. Invite 150 guests, watch them
                reply, and check people in. You only choose a plan when you
                send more invitations than the free 150.
              </p>
            </details>
            <details>
              <summary>What happens after the wedding?</summary>
              <p>
                You get a report: who came, who didn&rsquo;t, when people
                arrived, which gate they used, and anyone turned away. Download
                it as a spreadsheet. Your data stays yours and you can delete
                it whenever you like.
              </p>
            </details>
          </div>

          <div className="newstrip">
            <b>We&rsquo;re new.</b> This is our first season, and we&rsquo;d
            rather say so than invent testimonials. If you&rsquo;re planning a
            wedding and want a hand setting it up, message us — you&rsquo;ll
            get a real person, and probably the person who built it.
          </div>
        </div>
      </section>

      {/* ================= INSTITUTIONS ================= */}
      <section className="inst" id="inst">
        <div className="wrap">
          <div className="kicker">Beyond weddings</div>
          <h2 className="big serif">The same system, at a bigger gate</h2>
          <p className="sublede">
            Weddings are the hardest version of this problem: no tickets, no
            barriers, everyone knows somebody. What handles that handles a
            graduation or a conference comfortably.
          </p>

          <div className="instgrid">
            <div className="instlist">
              <div className="instrow">
                <span className="ic">◆</span>
                <div>
                  <b>Universities and schools</b>
                  <p>
                    Matriculation, convocation, prize days. Thousands of guests
                    through eight gates on one morning.
                  </p>
                </div>
              </div>
              <div className="instrow">
                <span className="ic">◆</span>
                <div>
                  <b>Churches and mosques</b>
                  <p>
                    Programmes that repeat across days and sessions, with
                    attendance tracked separately for each.
                  </p>
                </div>
              </div>
              <div className="instrow">
                <span className="ic">◆</span>
                <div>
                  <b>Companies and conferences</b>
                  <p>
                    Named delegates, printed badges, and a record of exactly
                    who was in the building.
                  </p>
                </div>
              </div>
              <div className="instrow">
                <span className="ic">◆</span>
                <div>
                  <b>Government and restricted events</b>
                  <p>
                    Different passes for different areas, and a complete audit
                    trail of every entry and every refusal.
                  </p>
                </div>
              </div>
            </div>
            <div>
              <p className="inst-copy">
                Multiple gates running at once, staff who only see their own
                entrance, and a permanent log of who came in, when, through
                where, and who was turned away.
              </p>
              <p className="inst-copy">
                Annual pricing, and a conversation first rather than a signup
                form.
              </p>
              <a
                className="btn pri lg"
                href="mailto:hello@gtfd.ng"
                style={{ marginTop: 22 }}
              >
                Talk to us about your organisation
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FINAL ================= */}
      <section className="final">
        <div className="wrap">
          <div className="rulegold" style={{ marginBottom: 30 }} />
          <h2 className="serif">Start with your guest list</h2>
          <p>
            Build the whole thing free. Decide on a plan when you&rsquo;re
            ready to invite people.
          </p>
          <div style={{ marginTop: 32 }}>
            <Link className="btn ivory lg" href="/login">
              Create your event
            </Link>
          </div>
          <p className="fine">
            First 150 guests free · No card needed · Takes about two minutes
          </p>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="fgrid">
            <div style={{ maxWidth: 250 }}>
              <Link className="brand" href="/">
                <Brand tone="light" size="sm" />
              </Link>
              <p className="fabout">
                Guest lists, invitations and entry, for Nigerian weddings and
                everything larger.
              </p>
            </div>
            <div className="sp" />
            <div className="fcol">
              <h4>Product</h4>
              <a href="#how">How it works</a>
              <a href="#price">Pricing</a>
              <a href="#inst">For organisations</a>
              <Link href="/login">Log in</Link>
            </div>
            <div className="fcol">
              <h4>Company</h4>
              <a href="mailto:hello@gtfd.ng">Contact</a>
              <a href="mailto:hello@gtfd.ng">WhatsApp us</a>
            </div>
            <div className="fcol">
              <h4>Legal</h4>
              <a href="#">Terms</a>
              <a href="#">Privacy</a>
              <a href="#">How we handle guest data</a>
            </div>
          </div>
          <div className="fbot">
            <span>© 2026</span>
            <div className="sp" />
            <span>Lagos, Nigeria</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
