import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";

/**
 * Reports.
 *
 * The funnel, the arrival curve, the catalogue of reports you can take,
 * and a history of the ones actually taken.
 *
 * No report file is stored. Each export is built from live data when it is
 * asked for, so the same report a week apart tells two different true
 * things rather than one stale one, and there is no file to go missing.
 * What is kept is the record of who took what and when — the part an
 * organiser actually refers back to.
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
};

type Rsvps = {
  counts: {
    households: number;
    confirmed: number;
    declined: number;
    pending: number;
    no_response: number;
    responded: number;
    responded_people: number;
    confirmed_people: number;
    invited_people: number;
  };
};

type Runs = {
  runs: {
    id: string;
    kind: string;
    format: string;
    generated_at: string;
    row_count: number | null;
    generated_by: string | null;
  }[];
  counts: { total: number; kinds: number; last_at: string | null };
};

const KINDS: Record<string, { name: string; sub: string; tone: string }> = {
  guests: {
    name: "Guest Summary Report",
    sub: "Every household and its details",
    tone: "guest",
  },
  rsvp: {
    name: "RSVP Summary Report",
    sub: "Replies and their breakdown",
    tone: "rsvp",
  },
  checkin: {
    name: "Check-in Summary Report",
    sub: "Arrivals, gates and refusals",
    tone: "checkin",
  },
  seating: {
    name: "Table & Seating Report",
    sub: "Occupancy and assignments",
    tone: "seating",
  },
  performance: {
    name: "Event Performance Report",
    sub: "The funnel end to end",
    tone: "perf",
  },
};

const PER = 10;

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  const { data: ci } = await api<CheckIn>(`/events/${id}/checkin`);
  const { data: rs } = await api<Rsvps>(`/events/${id}/rsvps?limit=1`);
  const { data: hist } = await api<Runs>(`/events/${id}/report-runs`);

  const invited = ci.totals.invited_people;
  // Every stage in PEOPLE. Mixing households into the middle of a funnel
  // whose ends are people is how it came to read "148 confirmed, 301
  // arrived" — a number that cannot happen and instantly discredits the
  // rest of the page.
  const responded = rs.counts.responded_people;
  const confirmed = rs.counts.confirmed_people;
  const arrived = ci.totals.checked_in;
  const noShow = Math.max(0, confirmed - arrived);

  const pct = (n: number) => (invited > 0 ? (n / invited) * 100 : 0);
  const p1 = (n: number) => `${pct(n).toFixed(1)}%`;

  const funnel = [
    { label: "Invited", n: invited, tone: "#163300" },
    { label: "RSVP received", n: responded, tone: "#2f6b1c" },
    { label: "Confirmed", n: confirmed, tone: "#7a52c7" },
    { label: "Checked in", n: arrived, tone: "#e0803a" },
    { label: "No show", n: noShow, tone: "#c62828" },
  ];

  const peak = Math.max(1, ...ci.timeline.map((h) => h.n));

  const cards = [
    {
      label: "Total Guests", n: invited, foot: "100% of total", tone: "",
      d: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    },
    {
      label: "Confirmed (RSVP)", n: confirmed, foot: `${p1(confirmed)} of total`,
      tone: "ok", d: "M20 6 9 17l-5-5",
    },
    {
      label: "Checked In", n: arrived, foot: `${p1(arrived)} of total`,
      tone: "mute", d: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
    },
    {
      label: "No Show", n: noShow, foot: `${p1(noShow)} of total`, tone: "err",
      d: "M15 9l-6 6m0-6 6 6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    },
  ];

  const R = 26;
  const CIRC = 2 * Math.PI * R;
  const rate = pct(arrived);

  const fmtDate = new Intl.DateTimeFormat("en-NG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos",
  });
  const fmtTime = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos",
  });

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const shown = hist.runs.slice((page - 1) * PER, page * PER);
  const pages = Math.max(1, Math.ceil(hist.runs.length / PER));

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My Events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>Reports</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">Reports</h1>
          <p className="sub">
            View insights and export reports to track your event performance.
          </p>
        </div>
        <div className="head-actions">
          <a className="primary" href={`/events/${id}/report/export?kind=performance`}>
            Export All Reports
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
              <p className="stat-value">{c.n.toLocaleString("en-NG")}</p>
              <p className="stat-foot">{c.foot}</p>
            </div>
          </div>
        ))}

        <div className="card stat capacity">
          <span className="cap-ring" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r={R} className="ring-track" />
              <circle cx="32" cy="32" r={R} className="ring-fill"
                strokeDasharray={`${(CIRC * rate) / 100} ${CIRC}`}
                transform="rotate(-90 32 32)" />
            </svg>
          </span>
          <div>
            <p className="stat-label">Check-in Rate</p>
            <p className="stat-value">{rate.toFixed(1)}%</p>
            <p className="stat-foot">of total guests</p>
          </div>
        </div>
      </div>

      <div className="grid-live">
        <section className="card">
          <h2 className="card-title">Guest Journey Overview</h2>
          <div className="funnel">
            {funnel.map((f, i) => (
              <div className="fstage" key={f.label}>
                <span className="fbar" style={{
                  width: `${Math.max(14, invited > 0 ? (f.n / invited) * 100 : 0)}%`,
                  background: f.tone,
                }} />
                <span className="flabel">
                  <i style={{ background: f.tone }} />
                  {f.label}
                </span>
                <span className="fn">{f.n.toLocaleString("en-NG")}</span>
                <span className="fc">{i === 0 ? "100%" : p1(f.n)}</span>
              </div>
            ))}
          </div>
          <p className="foot">Count and conversion, against everyone invited.</p>
        </section>

        <section className="card">
          <h2 className="card-title">
            Check-in Over Time
            <span className="muted-count">last 12 hours</span>
          </h2>
          {ci.totals.scans === 0 ? (
            <p className="sub">No arrivals recorded yet.</p>
          ) : (
            <div className="chart">
              <div className="bars tall">
                {ci.timeline.map((h) => (
                  <span key={h.hour} className="bar"
                    style={{ height: `${Math.max(2, (h.n / peak) * 100)}%` }}
                    title={`${h.hour} — ${h.n} checked in`} />
                ))}
              </div>
              <div className="axis">
                <span>{ci.timeline[0]?.hour}</span>
                <span>{ci.timeline[Math.floor(ci.timeline.length / 2)]?.hour}</span>
                <span>{ci.timeline[ci.timeline.length - 1]?.hour}</span>
              </div>
              <div className="yhint">peak {peak} in an hour</div>
            </div>
          )}
        </section>

        <aside className="rail">
          <section className="card">
            <h2 className="card-title">Reports Overview</h2>
            <ul className="mini-stats">
              <li>
                <b>{Object.keys(KINDS).length}</b>
                <small>Report types</small>
              </li>
              <li>
                <b>{hist.counts.total}</b>
                <small>Exports taken</small>
              </li>
              <li>
                <b>{hist.counts.kinds}</b>
                <small>Types used</small>
              </li>
              <li>
                <b>
                  {hist.counts.last_at
                    ? fmtDate.format(new Date(hist.counts.last_at))
                    : "—"}
                </b>
                <small>Last generated</small>
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 className="card-title">Quick Actions</h2>
            <ul className="actions">
              {Object.entries(KINDS).map(([kind, k]) => (
                <li key={kind}>
                  <a href={`/events/${id}/report/export?kind=${kind}`}>
                    <strong>{k.name}</strong>
                    <small>{k.sub}</small>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <div className="card">
        <h2 className="card-title">
          Export history
          <span className="muted-count">
            {hist.runs.length === 0
              ? "nothing exported yet"
              : `${hist.runs.length} run${hist.runs.length === 1 ? "" : "s"}`}
          </span>
        </h2>

        {hist.runs.length === 0 ? (
          <p className="sub">
            Nothing yet. Every export you take is recorded here with who took
            it and when. No file is kept — a report is rebuilt from live data
            each time, and a saved copy would go stale the moment the next
            guest walked in.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="list guests">
                <thead>
                  <tr>
                    <th>Report Name</th>
                    <th>Type</th>
                    <th>Date Generated</th>
                    <th>Generated By</th>
                    <th>Format</th>
                    <th>Rows</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const k = KINDS[r.kind] ?? {
                      name: r.kind,
                      sub: "",
                      tone: "guest",
                    };
                    return (
                      <tr key={r.id}>
                        <td>
                          <div className="who">
                            <span className={`rep-icon ${k.tone}`} aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="1.7" strokeLinecap="round"
                                strokeLinejoin="round">
                                <path d="M14 3v5h5M7 3h8l5 5v13H7zM9 13h6M9 17h4" />
                              </svg>
                            </span>
                            <div>
                              <b>{k.name}</b>
                              <small>{k.sub}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`chip type-${k.tone}`}>{r.kind}</span>
                        </td>
                        <td className="mono">
                          {fmtDate.format(new Date(r.generated_at))}
                          <small className="stack">
                            {fmtTime.format(new Date(r.generated_at))}
                          </small>
                        </td>
                        <td>{r.generated_by ?? <span className="none">—</span>}</td>
                        <td>
                          <span className="badge d-sent">
                            {r.format.toUpperCase()}
                          </span>
                        </td>
                        <td className="num">{r.row_count ?? "—"}</td>
                        <td className="right">
                          <a className="ghost sm"
                            href={`/events/${id}/report/export?kind=${r.kind}`}>
                            Run again
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hist.runs.length > PER && (
              <div className="pager">
                <span className="sub">
                  Showing {(page - 1) * PER + 1} to{" "}
                  {Math.min(page * PER, hist.runs.length)} of {hist.runs.length}
                </span>
                <div className="pages">
                  {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                    <Link key={n} className={`pagenum${n === page ? " on" : ""}`}
                      href={`/events/${id}/report?page=${n}`}>
                      {n}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
