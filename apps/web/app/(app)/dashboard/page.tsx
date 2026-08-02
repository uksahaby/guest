import Link from "next/link";
import { api } from "@/lib/org-api";

/**
 * The organiser's home screen.
 *
 * One API call. Every number on this page is a query — nothing is a stored
 * counter that can drift from the thing it counts, and nothing is invented
 * to fill a card. Where there is no data yet the panel says so plainly
 * rather than showing a confident zero.
 */

type Dash = {
  organiser: string | null;
  events: { id: string; name: string; starts_at: string | null }[];
  featured: {
    id: string;
    name: string;
    cover_image_url: string | null;
    starts_at: string | null;
    venue_name: string | null;
    plan: string;
    days_until: number;
    tables: number;
  } | null;
  totals: {
    invited_people: number;
    invitations: number;
    invitations_sent: number;
    confirmed_people: number;
    arrived_people: number;
  } | null;
  rsvp: {
    confirmed: number;
    pending: number;
    declined: number;
    total: number;
  } | null;
  readiness: {
    state: "setting_up" | "on_track" | "needs_attention" | "ready" | "complete";
    items: {
      check: number;
      fact: string;
      action: string;
      href: string;
      urgent: boolean;
    }[];
  } | null;
  activity: {
    kind: "rsvp" | "checked_in" | "opened" | "sent";
    who: string;
    detail: string | null;
    at: string;
  }[];
};

const STATE_COPY: Record<string, { word: string; sub: string }> = {
  setting_up: { word: "Setting up", sub: "Finish the basics and the rest follows." },
  on_track: { word: "On track", sub: "Nothing needs you right now." },
  needs_attention: { word: "Needs attention", sub: "A few things are due." },
  ready: { word: "Ready", sub: "Everything that matters is done." },
  complete: { word: "Complete", sub: "This event has happened." },
};

function greeting(): string {
  const h = new Date().toLocaleString("en-NG", {
    hour: "numeric",
    hour12: false,
    timeZone: "Africa/Lagos",
  });
  const n = Number(h);
  if (n < 12) return "Good morning";
  if (n < 17) return "Good afternoon";
  return "Good evening";
}

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function activityLine(a: Dash["activity"][number]): string {
  switch (a.kind) {
    case "rsvp":
      return a.detail === "declined"
        ? `${a.who} replied no`
        : `${a.who} replied yes`;
    case "checked_in":
      return `${a.who} checked in${a.detail ? ` (${a.detail})` : ""}`;
    case "opened":
      return `${a.who} opened their invitation`;
    default:
      return `Invitation sent to ${a.who}`;
  }
}

/** A ring, drawn with one stroked circle and a dash offset. */
function Ring({
  value,
  total,
  label,
  sub,
}: {
  value: number;
  total: number;
  label: string;
  sub: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? value / total : 0;
  return (
    <div className="ring">
      <svg viewBox="0 0 128 128" role="img" aria-label={`${label}: ${sub}`}>
        <circle cx="64" cy="64" r={r} className="ring-track" />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="ring-fill"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="ring-mid">
        <strong>{label}</strong>
        <small>{sub}</small>
      </div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  await searchParams; // the switcher's ?event= is read by the sidebar
  const { data } = await api<Dash>("/dashboard");

  const fmtDate = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
  const fmtTime = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    // en-NG defaults to 24-hour and then renders "4:05", which reads as
    // neither. Nigerian invitations say "4:00 PM".
    hour12: true,
    timeZone: "Africa/Lagos",
  });

  const f = data.featured;
  const t = data.totals;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page">
            {greeting()}
            {data.organiser ? `, ${data.organiser.split(" ")[0]}` : ""}
          </h1>
          <p className="sub">
            {f
              ? "Here's what's happening with your event."
              : "Let's set up your first event."}
          </p>
        </div>
        <Link className="primary" href="/events">
          + Create new event
        </Link>
      </div>

      {!f && (
        <div className="card empty">
          <h2>No events yet</h2>
          <p className="sub">
            An event holds your guest list, the gates and everyone checking
            people in.
          </p>
          <Link className="primary" href="/events">
            Create your first event
          </Link>
        </div>
      )}

      {f && t && (
        <>
          <div className="stats">
            <Stat
              label="Total guests"
              value={t.invited_people}
              foot={`${t.invitations} households`}
              icon="users"
            />
            <Stat
              label="Invitations sent"
              value={t.invitations_sent}
              foot={
                t.invitations > 0
                  ? `${t.invitations - t.invitations_sent} still to send`
                  : "no guests yet"
              }
              icon="mail"
            />
            <Stat
              label="RSVP confirmed"
              value={t.confirmed_people}
              foot={`of ${t.invited_people} invited`}
              icon="check"
            />
            <Stat
              label="Checked in"
              value={t.arrived_people}
              foot={f.days_until > 0 ? "on the day" : "so far"}
              icon="scan"
            />
          </div>

          <div className="grid-2">
            <section className="card featured">
              <span className="pill">Featured event</span>
              <div className="featured-body">
                {f.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="cover" src={f.cover_image_url} alt="" />
                ) : (
                  <div className="cover cover-blank" aria-hidden="true">
                    {f.name.slice(0, 1)}
                  </div>
                )}
                <div className="featured-text">
                  <h2>{f.name}</h2>
                  <ul className="facts">
                    <li>
                      {f.starts_at
                        ? fmtDate.format(new Date(f.starts_at))
                        : "Date not set"}
                    </li>
                    <li>
                      {f.starts_at
                        ? fmtTime.format(new Date(f.starts_at))
                        : "Time not set"}
                    </li>
                    <li>{f.venue_name ?? "Venue not set"}</li>
                  </ul>
                </div>
              </div>
              <div className="featured-foot">
                <b>
                  <span>{t.invited_people}</span>Invited
                </b>
                <b>
                  <span>{t.confirmed_people}</span>Confirmed
                </b>
                <b>
                  <span>{t.arrived_people}</span>Checked in
                </b>
                <b>
                  <span>{f.tables}</span>Tables
                </b>
                <Link className="ghost" href={`/events/${f.id}/guests`}>
                  Open event →
                </Link>
              </div>
            </section>

            <section className="card">
              <h2 className="card-title">RSVP progress</h2>
              {data.rsvp && data.rsvp.total > 0 ? (
                <>
                  <Ring
                    value={data.rsvp.confirmed}
                    total={data.rsvp.total}
                    label={`${Math.round(
                      (data.rsvp.confirmed / data.rsvp.total) * 100,
                    )}%`}
                    sub="confirmed"
                  />
                  <ul className="legend">
                    <li>
                      <i className="dot ok" />
                      {data.rsvp.confirmed} confirmed
                    </li>
                    <li>
                      <i className="dot warn" />
                      {data.rsvp.pending} pending
                    </li>
                    <li>
                      <i className="dot err" />
                      {data.rsvp.declined} declined
                    </li>
                  </ul>
                  <p className="foot">
                    Total households: {data.rsvp.total}
                  </p>
                </>
              ) : (
                <p className="sub">
                  Nobody has been invited yet, so there is nothing to track.
                </p>
              )}
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2 className="card-title">
                Needs your attention
                {data.readiness && (
                  <span className={`state ${data.readiness.state}`}>
                    {STATE_COPY[data.readiness.state]?.word}
                  </span>
                )}
              </h2>

              {data.readiness && data.readiness.items.length > 0 ? (
                <ul className="tasks">
                  {data.readiness.items.map((i) => (
                    <li key={i.check} className={i.urgent ? "urgent" : ""}>
                      <div>
                        <strong>{i.fact}</strong>
                        {i.urgent && <span className="due">Due now</span>}
                      </div>
                      <Link className="ghost sm" href={i.href}>
                        {i.action}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sub">
                  {data.readiness
                    ? STATE_COPY[data.readiness.state]?.sub
                    : "Nothing to do."}
                </p>
              )}
            </section>

            <section className="card">
              <h2 className="card-title">Recent activity</h2>
              {data.activity.length > 0 ? (
                <ul className="feed">
                  {data.activity.map((a, n) => (
                    <li key={`${a.kind}-${n}`}>
                      <i className={`fdot ${a.kind}`} />
                      <span>{activityLine(a)}</span>
                      <time>{ago(a.at)}</time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sub">
                  Nothing yet. Replies and check-ins show up here as they
                  happen.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  foot,
  icon,
}: {
  label: string;
  value: number;
  foot: string;
  icon: string;
}) {
  const paths: Record<string, string> = {
    users: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
    check: "M20 6 9 17l-5-5",
    scan: "M4 8V5h3m10 0h3v3M4 16v3h3m13-3v3h-3M8 12h8",
  };
  return (
    <div className="card stat">
      <span className="stat-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={paths[icon] ?? paths.users} />
        </svg>
      </span>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value.toLocaleString("en-NG")}</p>
        <p className="stat-foot">{foot}</p>
      </div>
    </div>
  );
}
