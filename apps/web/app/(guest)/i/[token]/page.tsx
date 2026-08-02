import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getInvitation, type PublicInvitation, type PublicLeg } from "./api";
import { reply, reopen } from "./actions";

/**
 * A household's own page: invitation, details, pass. Fully server-rendered;
 * tabs are links, the RSVP is a form, the QR is inline SVG. Zero client JS
 * beyond Next's baseline.
 *
 * The URL token IS the pass token — the same string the QR encodes.
 */

type Params = { token: string };
type Search = { tab?: string; replied?: string; change?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { token } = await params;
  const inv = await getInvitation(token);
  return { title: inv ? `${inv.event_name} — you're invited` : "Invitation" };
}

export default async function GuestPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  const inv = await getInvitation(token);
  if (!inv) notFound();

  const tab =
    sp.tab === "details" ? "details" : sp.tab === "pass" ? "pass" : "invite";

  // Single-leg UI as designed; multi-leg views arrive when a real customer
  // runs two ceremonies (HANDOFF §7).
  const leg = inv.legs[0];

  return (
    <div className="frame">
      <Hero inv={inv} leg={leg} />
      {inv.cancelled && <CancelledNotice />}
      <nav className="tabs" aria-label="Invitation sections">
        <Tab token={token} id="invite" current={tab} label="Invitation" />
        <Tab token={token} id="details" current={tab} label="Details" />
        <Tab token={token} id="pass" current={tab} label="My pass" />
      </nav>
      {tab === "invite" && (
        <section className="panel">
          {leg && !inv.cancelled ? (
            <Rsvp token={token} leg={leg} forceForm={sp.change === "1"} />
          ) : null}
        </section>
      )}
      {tab === "details" && (
        <section className="panel">
          <Details inv={inv} />
        </section>
      )}
      {tab === "pass" && (
        <section className="panel">
          <Pass inv={inv} leg={leg} token={token} />
        </section>
      )}
    </div>
  );
}

/**
 * Settings promises the guest a cancellation notice. It leads the page,
 * appears on every tab, and is deliberately plain — someone reading this
 * has probably already booked a flight.
 */
function CancelledNotice() {
  return (
    <div className="cancelled" role="status">
      <h2>This event has been cancelled</h2>
      <p>
        The organiser has called it off. Your pass will not open the gate,
        and there is nothing to reply to. Please contact them directly if
        you need to know more.
      </p>
    </div>
  );
}

function Tab({
  token,
  id,
  current,
  label,
}: {
  token: string;
  id: string;
  current: string;
  label: string;
}) {
  const href =
    id === "invite"
      ? `/i/${encodeURIComponent(token)}`
      : `/i/${encodeURIComponent(token)}?tab=${id}`;
  return (
    <Link className="tab" aria-current={current === id} href={href}>
      {label}
    </Link>
  );
}

// ---------------------------------------------------------------- hero

function Hero({ inv, leg }: { inv: PublicInvitation; leg?: PublicLeg }) {
  const couple = inv.event_name.split("&").map((s) => s.trim());
  const date = leg
    ? new Intl.DateTimeFormat("en-NG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Lagos",
      }).format(new Date(leg.starts_at))
    : null;

  return (
    <header className="hero">
      <div className="forwho fade">
        For <b>{inv.display_name}</b>
      </div>
      <div className="names fade">
        {couple.length === 2 ? (
          <>
            <span className="n">{couple[0]}</span>
            <span className="amp">&amp;</span>
            <span className="n">{couple[1]}</span>
          </>
        ) : (
          <span className="single">{inv.event_name}</span>
        )}
      </div>
      <div className="rule fade" />
      <p className="invited fade">
        request the pleasure of
        <br />
        your company
      </p>
      {date && leg && (
        <div className="when fade">
          <div className="d">{date}</div>
          {leg.venue_name && <div className="p">{leg.venue_name}</div>}
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------- rsvp

function Rsvp({
  token,
  leg,
  forceForm,
}: {
  token: string;
  leg: PublicLeg;
  forceForm: boolean;
}) {
  const replied = leg.rsvp !== "pending" && !forceForm;
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten"];

  if (replied) {
    const declined = leg.rsvp === "declined";
    const n = leg.rsvp_count ?? leg.allowance;
    return (
      <div className="done">
        <div className="mark">{declined ? "✕" : "✓"}</div>
        <h3>{declined ? "Thank you for letting us know" : "You're confirmed"}</h3>
        <p>
          {declined
            ? "We're sorry to miss you. You can change your reply any time."
            : `${words[n] ?? n} of you are expected. Your pass is ready.`}
        </p>
        {!declined && (
          <Link className="btn" href={`/i/${encodeURIComponent(token)}?tab=pass`}>
            Open my pass
          </Link>
        )}
        <form action={reopen}>
          <input type="hidden" name="token" value={token} />
          <button className="btn ghost" type="submit">
            Change my reply
          </button>
        </form>
      </div>
    );
  }

  const counts = Array.from({ length: leg.allowance }, (_, i) => i + 1);
  return (
    <div>
      <p className="sec">Your reply</p>
      <p className="q">
        {leg.allowance === 1 ? (
          <>We&rsquo;ve saved you a seat.<br />Will you come?</>
        ) : (
          <>
            You&rsquo;re invited for {words[leg.allowance]?.toLowerCase() ?? leg.allowance}.
            <br />
            How many will come?
          </>
        )}
      </p>
      <p className="qsub">
        Replying helps the couple plan — but your pass is yours either way.
      </p>
      <form action={reply}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="leg_id" value={leg.leg_id} />
        {leg.allowance > 1 && (
          <div className="counts">
            {counts.map((n) => (
              <label className="ct" key={n}>
                <input
                  type="radio"
                  name="count"
                  value={n}
                  defaultChecked={n === (leg.rsvp_count || leg.allowance)}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
        )}
        {leg.allowance === 1 && (
          <input type="hidden" name="count" value="1" />
        )}

        {/* How many of them are children.
            Optional, and blank by default: caterers need the split, but a
            household that skips the question has said nothing, and "0" is
            an answer we would be putting in their mouth. Plain number
            input — this page carries no client JavaScript, because on
            Nigerian mobile data that is not a hypothetical. */}
        <label className="kids">
          <span>Any children in your party?</span>
          <input
            type="number"
            name="children"
            min={0}
            max={leg.allowance}
            placeholder="Optional"
            inputMode="numeric"
          />
        </label>
        <button className="btn" type="submit" name="intent" value="confirm">
          {leg.allowance === 1 ? "We'll be there" : "Confirm"}
        </button>
        <button className="btn ghost" type="submit" name="intent" value="decline">
          We can&rsquo;t make it
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------- details

function Details({ inv }: { inv: PublicInvitation }) {
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-NG", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Africa/Lagos",
    }).format(new Date(iso));

  return (
    <>
      <p className="sec">The day</p>
      <div className="card">
        <dl>
          {inv.legs.map((l) => (
            <div className="line" key={l.leg_id}>
              <dt>{l.name}</dt>
              <dd>{time(l.starts_at)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {inv.legs.map(
        (l) =>
          l.venue_name && (
            <div key={l.leg_id}>
              <p className="sec">Where</p>
              <div className="card">
                <div className="serif" style={{ fontSize: 22 }}>
                  {l.venue_name}
                </div>
                {l.address_line && (
                  <div
                    style={{
                      fontSize: 14,
                      color: "var(--muted)",
                      marginTop: 6,
                      lineHeight: 1.55,
                    }}
                  >
                    {l.address_line}
                  </div>
                )}
                {l.map_url && (
                  <a className="maplink" href={l.map_url} target="_blank" rel="noreferrer">
                    Open in Maps
                  </a>
                )}
              </div>
            </div>
          ),
      )}

      {inv.note && (
        <>
          <p className="sec">Notes from the couple</p>
          <div className="card">
            <div style={{ fontSize: 14.5, lineHeight: 1.7 }}>{inv.note}</div>
          </div>
        </>
      )}

      <p className="note">Bring the pass on your phone. Screenshots work.</p>
    </>
  );
}

// ---------------------------------------------------------------- pass

async function Pass({
  inv,
  leg,
  token,
}: {
  inv: PublicInvitation;
  leg?: PublicLeg;
  token: string;
}) {
  // No QR for a cancelled event. Printing one that the gate is guaranteed
  // to refuse sends a guest to a venue to be turned away at the door.
  if (inv.cancelled) {
    return (
      <div className="done">
        <div className="mark">✕</div>
        <h3>This pass is not active</h3>
        <p>
          {inv.event_name} was cancelled, so there is no pass to scan. If the
          event is put back on, your pass here starts working again.
        </p>
      </div>
    );
  }

  // The QR encodes the pass token — verified offline at the gate.
  const qrSvg = await QRCode.toString(token, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#14300F", light: "#FFFFFF" },
  });

  const date = leg
    ? new Intl.DateTimeFormat("en-NG", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Lagos",
      }).format(new Date(leg.starts_at))
    : null;

  const admits =
    leg && leg.rsvp !== "pending" && leg.rsvp_count
      ? leg.rsvp_count
      : leg?.allowance;

  return (
    <>
      <div className="pass">
        <div className="pass-top">
          <div className="ev">{inv.event_name}</div>
          {date && (
            <div className="dt">
              {date}
              {leg?.venue_name ? ` · ${leg.venue_name}` : ""}
            </div>
          )}
        </div>
        <div className="perf">
          <div className="dash" />
        </div>
        <div className="pass-body">
          <div
            className="qr"
            role="img"
            aria-label="Entry code"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          {admits != null && <div className="admits">Admits {admits}</div>}
          <div className="pass-who">{inv.display_name}</div>
          {leg?.table_name && (
            <div className="table-chip">
              <b>Table</b>
              {leg.table_name.replace(/^table\s*/i, "")}
            </div>
          )}
          <div className="pass-foot">
            Show this at the gate.
            <br />
            Works without signal.
          </div>
        </div>
      </div>
      <p className="note">
        This pass is yours whether or not you&rsquo;ve replied — but replying
        helps the couple plan.
      </p>
    </>
  );
}
