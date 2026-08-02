import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { LiveRefresh } from "./LiveRefresh";

/**
 * Check-in: what the gate is doing, right now.
 *
 * Every number is counted from check_in_events. Nothing on this page keeps
 * its own tally, because a dashboard with its own tally is one that
 * eventually disagrees with the door — and the door is right.
 */

type CheckIn = {
  leg_id: string;
  totals: {
    invited_people: number;
    households: number;
    checked_in: number;
    not_checked_in: number;
    scans: number;
    today: number;
    last_scan_at: string | null;
  };
  timeline: { hour: string; n: number }[];
  entrances: {
    id: string;
    name: string;
    admitted: number;
    ushers: string | null;
    last_seen_at: string | null;
  }[];
  recent: {
    id: string;
    admitted_count: number;
    scanned_at: string;
    result: string;
    display_name: string;
    entrance_name: string | null;
    staff_name: string | null;
    table_name: string | null;
  }[];
};

function initial(name: string): string {
  const w = name.trim().split(/\s+/).filter((x) => /[A-Za-zÀ-ɏ]/.test(x));
  return (w[w.length - 1] ?? name).slice(0, 1).toUpperCase();
}

function ago(iso: string | null): string {
  if (!iso) return "no activity yet";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** A gate is "live" if it has scanned in the last quarter of an hour. */
function isLive(iso: string | null): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < 15 * 60_000;
}

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  const { status: cst, data } = await api<CheckIn>(`/events/${id}/checkin`);
  if (cst !== 200) notFound();

  const t = data.totals;
  const rate =
    t.invited_people > 0 ? (t.checked_in / t.invited_people) * 100 : 0;

  const fmtT = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  });

  const peak = Math.max(1, ...data.timeline.map((x) => x.n));
  const R = 52;
  const CIRC = 2 * Math.PI * R;

  const cards = [
    { label: "Total Guests", n: t.invited_people, foot: `${t.households} households`,
      tone: "", d: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" },
    { label: "Checked In", n: t.checked_in, foot: `${t.scans} scans`,
      tone: "ok", d: "M20 6 9 17l-5-5" },
    { label: "Not Checked In", n: t.not_checked_in, foot: "still expected",
      tone: "warn", d: "M12 17h.01M9.1 9a3 3 0 1 1 4.2 2.8c-.8.4-1.3 1.2-1.3 2.2" },
    { label: "Check-in Rate", n: Math.round(rate), foot: "of total guests",
      tone: "mute", suffix: "%", d: "M5 20V10m7 10V4m7 16v-7" },
    { label: "Today's Check-ins", n: t.today, foot: "since midnight",
      tone: "", d: "M3 8h18M7 3v4m10-4v4M4 5h16v16H4z" },
  ];

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My Events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>Check-in</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">Check-in</h1>
          <p className="sub">
            Monitor guest arrivals and manage event entry in real time.
          </p>
        </div>
        <div className="head-actions">
          <a className="primary" href={`/scan/${data.leg_id}`}>Open Scanner</a>
          <Link className="ghost" href={`/events/${id}/guests`}>Manual Check-in</Link>
          <a className="ghost" href={`/events/${id}/report/export`}>
            Export Check-in Report
          </a>
        </div>
      </div>

      <div className="stats five">
        {cards.map((c) => (
          <div className="card stat" key={c.label}>
            <span className={`stat-icon ${c.tone}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={c.d} />
              </svg>
            </span>
            <div>
              <p className="stat-label">{c.label}</p>
              <p className="stat-value">
                {c.n.toLocaleString("en-NG")}{c.suffix ?? ""}
              </p>
              <p className="stat-foot">{c.foot}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-live">
        {/* ------------------------------------------- live progress */}
        <section className="card">
          <h2 className="card-title">
            Live Check-in Progress
            <span className="live-dot">LIVE</span>
          </h2>

          <div className="progress-row">
            <div className="ring">
              <svg viewBox="0 0 128 128" role="img"
                aria-label={`${rate.toFixed(1)}% checked in`}>
                <circle cx="64" cy="64" r={R} className="ring-track" />
                <circle cx="64" cy="64" r={R} className="ring-fill"
                  strokeDasharray={`${(CIRC * rate) / 100} ${CIRC}`}
                  transform="rotate(-90 64 64)" />
              </svg>
              <div className="ring-mid">
                <strong>{rate.toFixed(1)}%</strong>
                <small>Check-in Rate</small>
              </div>
            </div>

            <div className="progress-side">
              <p className="arrived">
                <b>{t.checked_in.toLocaleString("en-NG")}</b> of{" "}
                {t.invited_people.toLocaleString("en-NG")} guests have arrived
              </p>
              <div className="bar">
                <span style={{ width: `${Math.min(100, rate)}%` }} />
              </div>
              <div className="two-mini">
                <div>
                  <small>Checked In</small>
                  <b className="ok">{t.checked_in.toLocaleString("en-NG")}</b>
                </div>
                <div>
                  <small>Not Checked In</small>
                  <b className="warn">{t.not_checked_in.toLocaleString("en-NG")}</b>
                </div>
              </div>
            </div>
          </div>

          <p className="foot">
            <LiveRefresh />
          </p>
        </section>

        {/* ------------------------------------------------ timeline */}
        <section className="card">
          <h2 className="card-title">
            Check-in Timeline
            <span className="muted-count">last 12 hours</span>
          </h2>
          {t.scans === 0 ? (
            <p className="sub">
              Nobody has been scanned yet. Arrivals appear here as they
              happen.
            </p>
          ) : (
            <ul className="hours">
              {data.timeline.map((h) => (
                <li key={h.hour}>
                  <span className="hr">{h.hour}</span>
                  <span className="hbar">
                    <i style={{ width: `${(h.n / peak) * 100}%` }} />
                  </span>
                  <span className="hn">{h.n}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="foot">Number of check-ins</p>
        </section>

        {/* ------------------------------------------- quick actions */}
        <aside className="rail">
          <section className="card">
            <h2 className="card-title">Quick Actions</h2>
            <a className="primary wide" href={`/scan/${data.leg_id}`}>
              Scan QR Code
            </a>
            <ul className="actions">
              <li>
                <Link href={`/events/${id}/guests`}>
                  <strong>Search Guest</strong>
                  <small>Find a household by name or phone</small>
                </Link>
              </li>
              <li>
                <Link href={`/events/${id}/guests`}>
                  <strong>Manual Check-in</strong>
                  <small>Admit someone whose pass will not scan</small>
                </Link>
              </li>
              <li>
                <Link href={`/events/${id}/report`}>
                  <strong>View All Check-ins</strong>
                  <small>The full arrival record</small>
                </Link>
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 className="card-title">
              Live Status
              <span className="live-dot">LIVE</span>
            </h2>
            <div className="status-row">
              <span className={`pulse ${isLive(t.last_scan_at) ? "on" : ""}`}
                aria-hidden="true" />
              <div>
                <strong>
                  {isLive(t.last_scan_at)
                    ? "Scanning now"
                    : t.last_scan_at
                      ? "Quiet at the gate"
                      : "No scans yet"}
                </strong>
                <small>
                  {t.last_scan_at
                    ? `Last scan ${ago(t.last_scan_at)}`
                    : "The first scan will show here"}
                </small>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {/* --------------------------------------------- entrances */}
      <div className="card">
        <h2 className="card-title">
          Entrance Monitoring
          <Link className="ghost sm" href={`/events/${id}/team`}>
            Manage Entrances
          </Link>
        </h2>
        {data.entrances.length === 0 ? (
          <p className="sub">
            No gates yet. Add one on the Gates &amp; Team page.
          </p>
        ) : (
          <div className="gates">
            {data.entrances.map((g) => (
              <div className="gate" key={g.id}>
                <div className="gate-head">
                  <span className="gate-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6" />
                    </svg>
                  </span>
                  <div>
                    <strong>{g.name}</strong>
                    <small>{g.ushers ?? "Nobody assigned"}</small>
                  </div>
                  <span className={`pill-live ${isLive(g.last_seen_at) ? "on" : ""}`}>
                    {isLive(g.last_seen_at) ? "Live" : "Idle"}
                  </span>
                </div>
                <p className="gate-n">
                  <b>{g.admitted.toLocaleString("en-NG")}</b> checked in
                </p>
                <p className="gate-foot">Last activity: {ago(g.last_seen_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------ recent check-ins */}
      <div className="card">
        <h2 className="card-title">
          Recent Check-ins
          <Link className="ghost sm" href={`/events/${id}/report`}>
            View All Check-ins
          </Link>
        </h2>
        {data.recent.length === 0 ? (
          <p className="sub">Nothing yet. Arrivals appear here as they happen.</p>
        ) : (
          <div className="table-wrap">
            <table className="list guests">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Table</th>
                  <th>Check-in Time</th>
                  <th>Entrance</th>
                  <th>Checked In By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="who">
                        <span className="avatar" aria-hidden="true">
                          {initial(r.display_name)}
                        </span>
                        <div>
                          <b>{r.display_name}</b>
                          <small>
                            {r.admitted_count}{" "}
                            {r.admitted_count === 1 ? "person" : "people"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{r.table_name ?? <span className="none">—</span>}</td>
                    <td className="mono">
                      {fmtT.format(new Date(r.scanned_at))}
                    </td>
                    <td>
                      <span className="gate-tag">
                        <i />
                        {r.entrance_name ?? "—"}
                      </span>
                    </td>
                    <td>{r.staff_name ?? <span className="none">—</span>}</td>
                    <td>
                      <span className="badge attending">Checked In</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
