import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/org-api";
import { Countdown } from "./Countdown";

/**
 * One event, at a glance.
 *
 * The same numbers as the dashboard's featured card, from the same query,
 * because two screens that count arrivals separately eventually disagree
 * in front of the person they are meant to reassure.
 *
 * Readiness is a word and a checklist, not a percentage — see
 * spec/event-readiness-rules.md. The checklist shows every applicable
 * check, done or due; the number lives inside each sentence, which is the
 * only progress bar this needs.
 */

type Overview = {
  event: {
    id: string;
    name: string;
    event_type: string;
    status: string;
    plan: string;
    cover_image_url: string | null;
    starts_at: string | null;
    venue_name: string | null;
    leg_id: string | null;
    leg_name: string | null;
    days_until: number;
  };
  counts: { tables: number; entrances: number; staff: number };
  totals: {
    invited_people: number;
    invitations: number;
    invitations_sent: number;
    last_sent_at: string | null;
    confirmed_people: number;
    arrived_people: number;
    seated: number;
  };
  rsvp: { confirmed: number; pending: number; declined: number; total: number };
  readiness: {
    state: "setting_up" | "on_track" | "needs_attention" | "ready" | "complete";
    items: {
      check: number;
      fact: string;
      action: string;
      href: string;
      urgent: boolean;
    }[];
    all: {
      check: number;
      fact: string;
      href: string;
      done: boolean;
      urgent: boolean;
      urgent_in: number;
    }[];
  };
  activity: {
    kind: "rsvp" | "checked_in" | "opened" | "sent";
    who: string;
    detail: string | null;
    at: string;
  }[];
};

const STATE_WORD: Record<string, string> = {
  setting_up: "Setting up",
  on_track: "On track",
  needs_attention: "Needs attention",
  ready: "Ready",
  complete: "Complete",
};

const STATE_SUB: Record<string, string> = {
  setting_up: "Finish the basics and the rest follows.",
  on_track: "Nothing needs you right now.",
  needs_attention: "A few things are due.",
  ready: "Everything that matters is done.",
  complete: "This event has happened.",
};

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

function activityLine(a: Overview["activity"][number]): string {
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

function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}

export default async function EventOverview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { status, data } = await api<Overview>(`/events/${id}/overview`);
  if (status !== 200) notFound();

  const { event: ev, totals: t, rsvp, readiness: r, counts } = data;

  const fmtDate = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
  const fmtTime = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  });

  const done = r.all.filter((c) => c.done).length;

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My events</Link>
        <span aria-hidden="true">›</span>
        <b>{ev.name}</b>
      </nav>

      <div className="grid-hero">
        <section className="card hero">
          <div className="hero-top">
            {ev.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cover" src={ev.cover_image_url} alt="" />
            ) : (
              <div className="cover cover-blank" aria-hidden="true">
                {ev.name.slice(0, 1)}
              </div>
            )}
            <div>
              <h1 className="page hero-name">
                {ev.name}
                {/* Timing, not readiness. The readiness word already has a
                    home in the panel beside this one, and saying it twice
                    on one screen makes it read as two different facts. */}
                <span className="state when">
                  {ev.days_until > 1
                    ? "Upcoming"
                    : ev.days_until === 1
                      ? "Tomorrow"
                      : ev.days_until === 0
                        ? "Today"
                        : "Past"}
                </span>
              </h1>
              <ul className="facts plain">
                <li>
                  {ev.starts_at
                    ? fmtDate.format(new Date(ev.starts_at))
                    : "Date not set"}
                </li>
                <li>
                  {ev.starts_at
                    ? fmtTime.format(new Date(ev.starts_at))
                    : "Time not set"}
                </li>
                <li>{ev.venue_name ?? "Venue not set"}</li>
              </ul>
              <div className="hero-actions">
                <Link className="ghost sm" href={`/events/${ev.id}/guests`}>
                  Guests
                </Link>
                <Link className="ghost sm" href={`/events/${ev.id}/settings`}>
                  Settings
                </Link>
                <Link className="ghost sm" href={`/events/${ev.id}/team`}>
                  Gates &amp; team
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">
            {ev.days_until >= 0 ? "Event starts in" : "This event has happened"}
          </h2>
          {ev.starts_at && <Countdown startsAt={ev.starts_at} />}

          <div className="ready-block">
            <div className="ready-head">
              <span>Readiness</span>
              <span className={`state ${r.state}`}>{STATE_WORD[r.state]}</span>
            </div>
            <p className="sub sm">{STATE_SUB[r.state]}</p>
          </div>
        </section>
      </div>

      <div className="stats five">
        <Stat
          label="Total guests"
          value={t.invited_people}
          foot={`${t.invitations} households`}
          icon="users"
        />
        <Stat
          label="RSVP confirmed"
          value={t.confirmed_people}
          foot={`${pct(t.confirmed_people, t.invited_people)}% of invited`}
          icon="check"
        />
        <Stat
          label="Invitations sent"
          value={t.invitations_sent}
          foot={
            t.last_sent_at ? `last sent ${ago(t.last_sent_at)}` : "none sent yet"
          }
          icon="mail"
        />
        <Stat
          label="Checked in"
          value={t.arrived_people}
          foot={
            t.confirmed_people > 0
              ? `${pct(t.arrived_people, t.confirmed_people)}% of confirmed`
              : "nobody yet"
          }
          icon="scan"
        />
        <Stat
          label="Tables"
          value={counts.tables}
          foot={`${t.seated} households seated`}
          icon="grid"
        />
      </div>

      <div className="grid-3">
        <section className="card">
          <h2 className="card-title">RSVP progress</h2>
          {rsvp.total > 0 ? (
            <>
              <Donut
                confirmed={rsvp.confirmed}
                pending={rsvp.pending}
                declined={rsvp.declined}
                total={rsvp.total}
              />
              <ul className="legend spread">
                <li>
                  <i className="dot ok" />
                  Confirmed
                  <b>
                    {rsvp.confirmed} ({pct(rsvp.confirmed, rsvp.total)}%)
                  </b>
                </li>
                <li>
                  <i className="dot warn" />
                  Pending
                  <b>
                    {rsvp.pending} ({pct(rsvp.pending, rsvp.total)}%)
                  </b>
                </li>
                <li>
                  <i className="dot err" />
                  Declined
                  <b>
                    {rsvp.declined} ({pct(rsvp.declined, rsvp.total)}%)
                  </b>
                </li>
              </ul>
              <Link className="ghost sm wide" href={`/events/${ev.id}/guests`}>
                View guest list →
              </Link>
            </>
          ) : (
            <p className="sub">
              Nobody has been invited yet, so there is nothing to track.
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">
            Event checklist
            <span className="muted-count">
              {done} of {r.all.length}
            </span>
          </h2>
          <ul className="checks">
            {r.all.map((c) => (
              <li
                key={c.check}
                className={c.done ? "done" : c.urgent ? "urgent" : ""}
              >
                <i aria-hidden="true" />
                <Link href={c.href}>{c.fact}</Link>
                <span>
                  {c.done
                    ? "Done"
                    : c.urgent
                      ? "Due now"
                      : `Due in ${Math.max(0, ev.days_until - c.urgent_in)} days`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="card-title">Needs your attention</h2>
          {r.items.length > 0 ? (
            <ul className="tasks">
              {r.items.map((i) => (
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
            <p className="sub">{STATE_SUB[r.state]}</p>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">Recent activity</h2>
        {data.activity.length > 0 ? (
          <ul className="feed row">
            {data.activity.slice(0, 5).map((a, n) => (
              <li key={`${a.kind}-${n}`}>
                <i className={`fdot ${a.kind}`} />
                <div>
                  <span>{activityLine(a)}</span>
                  <time>{ago(a.at)}</time>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">
            Nothing yet. Replies and check-ins show up here as they happen.
          </p>
        )}
      </section>
    </>
  );
}

/** Three arcs on one ring: confirmed, pending, declined. */
function Donut({
  confirmed,
  pending,
  declined,
  total,
}: {
  confirmed: number;
  pending: number;
  declined: number;
  total: number;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const seg = (n: number) => (total > 0 ? (n / total) * c : 0);
  const a = seg(confirmed);
  const b = seg(pending);
  const d = seg(declined);

  return (
    <div className="ring">
      <svg
        viewBox="0 0 128 128"
        role="img"
        aria-label={`${confirmed} confirmed, ${pending} pending, ${declined} declined`}
      >
        <circle cx="64" cy="64" r={r} className="ring-track" />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="ring-fill"
          strokeDasharray={`${a} ${c}`}
          transform="rotate(-90 64 64)"
        />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="ring-warn"
          strokeDasharray={`${b} ${c}`}
          strokeDashoffset={-a}
          transform="rotate(-90 64 64)"
        />
        <circle
          cx="64"
          cy="64"
          r={r}
          className="ring-err"
          strokeDasharray={`${d} ${c}`}
          strokeDashoffset={-(a + b)}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <div className="ring-mid">
        <strong>{confirmed}</strong>
        <small>confirmed</small>
      </div>
    </div>
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
    grid: "M4 5h16M4 12h16M4 19h16M9 5v14m6-14v14",
  };
  return (
    <div className="card stat">
      <span className="stat-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
