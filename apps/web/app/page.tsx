import type { Metadata } from "next";
import Link from "next/link";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./marketing.css";

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

export default function Home() {
  return (
    <div className={`mkt ${cormorant.variable} ${inter.variable}`}>
      <nav className="nav">
        <div className="wrap">
          <Link className="brand" href="/">
            <div className="m">◈</div>
            <span>Working name</span>
          </Link>
          <div className="sp" />
          <a className="lnk hideS" href="#how">
            How it works
          </a>
          <a className="lnk hideS" href="#price">
            Pricing
          </a>
          <a className="lnk hideS" href="#inst">
            For organisations
          </a>
          <Link className="lnk" href="/login">
            Log in
          </Link>
          <Link className="btn pri" href="/login">
            Create your event
          </Link>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header className="hero">
        <div className="wrap">
          <div className="eyebrow">For Nigerian weddings</div>
          <h1 className="serif">
            Everyone you invited.<em>Nobody you didn&rsquo;t.</em>
          </h1>
          <p className="lead">
            Send your invitations on WhatsApp, let each family reply, and check
            every guest in at the gate with a scan.
          </p>
          <div className="cta">
            <Link className="btn ivory lg" href="/login">
              Create your event free
            </Link>
            <a className="btn outline-i lg" href="#how">
              See how it works
            </a>
          </div>
          <p className="fine">Your first 150 guests are free · No card needed</p>
        </div>
      </header>

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
                <div className="m">◈</div>
                <span>Working name</span>
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
