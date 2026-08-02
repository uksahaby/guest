import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";

/**
 * RSVP management, laid out as the mockup draws it: four status cards and
 * a response-rate ring across the top, then progress / by-type / trend,
 * then the filter bar and the table.
 *
 * Every figure is a query. The three charts are drawn from one series —
 * responded_at by day — because a cumulative line and a daily bar computed
 * separately are two chances to disagree by a row.
 */

type Row = {
  id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  notes: string | null;
  category: string | null;
  rsvp: "attending" | "partial" | "declined" | "pending";
  rsvp_count: number | null;
  allowance: number;
  responded_at: string | null;
  adults: number | null;
  children: number | null;
  table_name: string | null;
  opened: boolean;
};

type Payload = {
  rows: Row[];
  total: number;
  limit: number;
  offset: number;
  counts: {
    households: number;
    confirmed: number;
    declined: number;
    pending: number;
    no_response: number;
    responded: number;
    invited_people: number;
    adults: number;
    children: number;
  };
  by_type: { name: string; n: number }[];
  trend: { day: string; n: number }[];
  categories: string[];
  tables: string[];
};

const PER_PAGE = 10;

function initial(name: string): string {
  const w = name.trim().split(/\s+/).filter((x) => /[A-Za-zÀ-ɏ]/.test(x));
  return (w[w.length - 1] ?? name).slice(0, 1).toUpperCase();
}

function withParams(
  base: Record<string, string | undefined>,
  change: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Slice colours, in the order the mockup lists them. */
const SLICE = ["#2f6b1c", "#3f7fd6", "#c0663a", "#e0a63a", "#7a52c7", "#8a9187"];

export default async function RsvpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    rsvp?: string;
    category?: string;
    table?: string;
    page?: string;
    days?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * PER_PAGE;
  const days = sp.days ?? "30";

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (sp.rsvp) query.set("rsvp", sp.rsvp);
  if (sp.category) query.set("category", sp.category);
  if (sp.table) query.set("table", sp.table);
  query.set("limit", String(PER_PAGE));
  query.set("offset", String(offset));
  query.set("days", days);

  const { data } = await api<Payload>(
    `/events/${id}/rsvps?${query.toString()}`,
  );

  const c = data.counts;
  const here = `/events/${id}/rsvps`;
  const base = {
    q: q || undefined,
    rsvp: sp.rsvp,
    category: sp.category,
    table: sp.table,
    days: days === "30" ? undefined : days,
  };
  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  const from = data.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PER_PAGE, data.total);

  const pct = (n: number) =>
    c.households > 0 ? ((n / c.households) * 100).toFixed(1) : "0.0";

  const responded = c.responded;
  const noResponse = c.households - responded;
  const responseRate =
    c.households > 0 ? ((responded / c.households) * 100).toFixed(1) : "0.0";

  const fmt = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
  const fmtT = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  });

  const cards = [
    { key: "confirmed", label: "Confirmed", n: c.confirmed, tone: "ok",
      d: "M20 6 9 17l-5-5" },
    { key: "pending", label: "Pending", n: c.pending, tone: "warn",
      d: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" },
    { key: "declined", label: "Declined", n: c.declined, tone: "err",
      d: "M15 9l-6 6m0-6 6 6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" },
    { key: "no_response", label: "No Response", n: c.no_response, tone: "mute",
      d: "M12 17h.01M9.1 9a3 3 0 1 1 4.2 2.8c-.8.4-1.3 1.2-1.3 2.2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" },
  ];

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My Events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>RSVPs</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">RSVP Management</h1>
          <p className="sub">
            Track guest responses, send reminders and manage RSVP details.
          </p>
        </div>
        <div className="head-actions">
          <Link className="ghost" href={`/events/${id}/guests?rsvp=no_response`}>
            Send Reminder
          </Link>
          <a className="ghost" href={`/events/${id}/report/export`}>
            Export RSVP Data
          </a>
          <Link className="primary" href={`/events/${id}/settings`}>
            RSVP Settings
          </Link>
        </div>
      </div>

      {/* Four status cards and the response rate, on one row. */}
      <div className="rsvp-top">
        <div className="stats four">
          {cards.map((card) => {
            const on = (sp.rsvp ?? "") === card.key;
            return (
              <Link
                key={card.key}
                href={`${here}${withParams(base, { rsvp: on ? undefined : card.key, page: undefined })}`}
                className={`card stat filter${on ? " on" : ""}`}
              >
                <span className={`stat-icon ${card.tone}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={card.d} />
                  </svg>
                </span>
                <div>
                  <p className="stat-label">{card.label}</p>
                  <p className="stat-value">{card.n.toLocaleString("en-NG")}</p>
                  <p className="stat-foot">{pct(card.n)}%</p>
                </div>
              </Link>
            );
          })}
        </div>

        <section className="card rate-card">
          <h2 className="card-title">Overall RSVP Response Rate</h2>
          <Ring value={responded} total={c.households} label={`${responseRate}%`}
            sub="Response Rate" />
          <ul className="legend spread">
            <li>
              <i className="dot ok" />Responded
              <b>{responded} ({responseRate}%)</b>
            </li>
            <li>
              <i className="dot mute" />No Response
              <b>
                {noResponse} (
                {c.households > 0
                  ? ((noResponse / c.households) * 100).toFixed(1)
                  : "0.0"}
                %)
              </b>
            </li>
          </ul>
        </section>
      </div>

      {/* Progress · by guest type · trend. */}
      <div className="grid-3 charts">
        <section className="card">
          <h2 className="card-title">
            RSVP Progress
            <span className="muted-count">
              {responded} of {c.households} responded
            </span>
          </h2>
          <AreaChart trend={data.trend} />
        </section>

        <section className="card">
          <h2 className="card-title">Responses by Guest Type</h2>
          <TypeDonut byType={data.by_type} total={responded} />
        </section>

        <section className="card">
          <h2 className="card-title">
            Response Trend
            <form method="GET" className="inline-select">
              {q && <input type="hidden" name="q" value={q} />}
              {sp.rsvp && <input type="hidden" name="rsvp" value={sp.rsvp} />}
              <select className="field xs" name="days" defaultValue={days}
                aria-label="Trend window">
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
              <button className="ghost xs" type="submit">Go</button>
            </form>
          </h2>
          <BarChart trend={data.trend} />
        </section>
      </div>

      <div className="card">
        <form method="GET" className="filters">
          <input className="field search" type="search" name="q" defaultValue={q}
            placeholder="Search by name, email or phone…" aria-label="Search" />
          <select className="field" name="rsvp" defaultValue={sp.rsvp ?? ""}
            aria-label="RSVP Status">
            <option value="">RSVP Status: All</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="declined">Declined</option>
            <option value="no_response">No Response</option>
          </select>
          <select className="field" name="category" defaultValue={sp.category ?? ""}
            aria-label="Guest Type">
            <option value="">Guest Type: All</option>
            {data.categories.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
          <select className="field" name="table" defaultValue={sp.table ?? ""}
            aria-label="Table">
            <option value="">Table: All</option>
            {data.tables.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
          <button className="ghost" type="submit">More Filters</button>
          {(q || sp.rsvp || sp.category || sp.table) && (
            <Link className="ghost" href={here}>Clear</Link>
          )}
        </form>

        {data.rows.length === 0 ? (
          <p className="sub" style={{ padding: "20px 0" }}>
            No households match those filters.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="list guests rsvp-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Guest Type</th>
                  <th>RSVP Status</th>
                  <th>Responded On</th>
                  <th>Adults</th>
                  <th>Children</th>
                  <th>Table</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="who">
                        <span className="avatar" aria-hidden="true">
                          {initial(r.display_name)}
                        </span>
                        <div>
                          <b>{r.display_name}</b>
                          <small>
                            {r.primary_email ?? r.primary_phone ?? "no contact"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {r.category ? (
                        <span className="chip">{r.category}</span>
                      ) : (
                        <span className="none">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.rsvp}`}>
                        {r.rsvp === "attending"
                          ? "Confirmed"
                          : r.rsvp === "partial"
                            ? `${r.rsvp_count} of ${r.allowance}`
                            : r.rsvp === "declined"
                              ? "Declined"
                              : r.opened
                                ? "Pending"
                                : "No Response"}
                      </span>
                    </td>
                    <td className="mono">
                      {r.responded_at ? (
                        <>
                          {fmt.format(new Date(r.responded_at))}
                          <small className="stack">
                            {fmtT.format(new Date(r.responded_at))}
                          </small>
                        </>
                      ) : (
                        <span className="none">—</span>
                      )}
                    </td>
                    <td className="num">
                      {r.adults ?? <span className="none">—</span>}
                    </td>
                    <td className="num">
                      {r.children ?? <span className="none">—</span>}
                    </td>
                    <td>{r.table_name ?? <span className="none">—</span>}</td>
                    <td>
                      {r.notes ? (
                        <span className="note">{r.notes}</span>
                      ) : (
                        <span className="none">—</span>
                      )}
                    </td>
                    <td className="right">
                      <Link className="ghost sm"
                        href={`/events/${id}/guests/${r.id}/link`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.total > 0 && (
          <div className="pager">
            <span className="sub">
              Showing {from} to {to} of {data.total.toLocaleString("en-NG")} guests
            </span>
            <div className="pages">
              {page > 1 && (
                <Link className="ghost sm"
                  href={`${here}${withParams(base, { page: String(page - 1) })}`}>
                  ‹
                </Link>
              )}
              {pageNumbers(page, pages).map((n, i) =>
                n === null ? (
                  <span key={`gap-${i}`} className="sub">…</span>
                ) : (
                  <Link
                    key={n}
                    className={`pagenum${n === page ? " on" : ""}`}
                    href={`${here}${withParams(base, { page: String(n) })}`}
                  >
                    {n}
                  </Link>
                ),
              )}
              {page < pages && (
                <Link className="ghost sm"
                  href={`${here}${withParams(base, { page: String(page + 1) })}`}>
                  ›
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** 1 2 3 4 5 … 69, as the mockup shows it. */
function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | null)[] = [];
  const window = [1, 2, 3, 4, 5];
  for (const n of window) if (n <= pages) out.push(n);
  if (page > 5 && page < pages) {
    out.push(null, page);
  } else {
    out.push(null);
  }
  out.push(pages);
  return out;
}

/** The response-rate ring. */
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
  const circ = 2 * Math.PI * r;
  const frac = total > 0 ? value / total : 0;
  return (
    <div className="ring">
      <svg viewBox="0 0 128 128" role="img" aria-label={`${label} ${sub}`}>
        <circle cx="64" cy="64" r={r} className="ring-track" />
        <circle cx="64" cy="64" r={r} className="ring-fill"
          strokeDasharray={`${circ * frac} ${circ}`}
          transform="rotate(-90 64 64)" />
      </svg>
      <div className="ring-mid">
        <strong>{label}</strong>
        <small>{sub}</small>
      </div>
    </div>
  );
}

/** Cumulative replies over the window — the running total of the trend. */
function AreaChart({ trend }: { trend: { day: string; n: number }[] }) {
  const W = 320;
  const H = 120;
  let run = 0;
  const points = trend.map((t) => (run += t.n));
  const max = Math.max(1, points[points.length - 1] ?? 1);
  const step = points.length > 1 ? W / (points.length - 1) : W;

  const line = points
    .map((v, i) => `${i * step},${H - (v / max) * H}`)
    .join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const labelAt = (i: number) =>
    new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" })
      .format(new Date(trend[i]!.day));

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        role="img" aria-label={`${max} replies over ${trend.length} days`}>
        <polygon className="area" points={area} />
        <polyline className="line" points={line} />
      </svg>
      <div className="axis">
        <span>{trend.length ? labelAt(0) : ""}</span>
        <span>{trend.length ? labelAt(Math.floor(trend.length / 2)) : ""}</span>
        <span>{trend.length ? labelAt(trend.length - 1) : ""}</span>
      </div>
      <div className="yhint">peak {max}</div>
    </div>
  );
}

/** Replies split by guest type. */
function TypeDonut({
  byType,
  total,
}: {
  byType: { name: string; n: number }[];
  total: number;
}) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-row">
      <div className="ring small">
        <svg viewBox="0 0 128 128" role="img" aria-label="Responses by guest type">
          <circle cx="64" cy="64" r={r} className="ring-track" />
          {byType.map((t, i) => {
            const len = total > 0 ? (t.n / total) * circ : 0;
            const el = (
              <circle
                key={t.name}
                cx="64"
                cy="64"
                r={r}
                className="slice"
                stroke={SLICE[i % SLICE.length]}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 64 64)"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
      </div>
      <ul className="legend">
        {byType.map((t, i) => (
          <li key={t.name}>
            <i className="dot" style={{ background: SLICE[i % SLICE.length] }} />
            {t.name}
            <b>
              {t.n} ({total > 0 ? ((t.n / total) * 100).toFixed(1) : "0.0"}%)
            </b>
          </li>
        ))}
        {byType.length === 0 && <li className="none">No replies yet</li>}
      </ul>
    </div>
  );
}

/** Replies per day. */
function BarChart({ trend }: { trend: { day: string; n: number }[] }) {
  const max = Math.max(1, ...trend.map((t) => t.n));
  const labelAt = (i: number) =>
    new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" })
      .format(new Date(trend[i]!.day));

  return (
    <div className="chart">
      <div className="bars" role="img"
        aria-label={`Daily replies, peak ${max}`}>
        {trend.map((t) => (
          <span
            key={t.day}
            className="bar"
            style={{ height: `${Math.max(2, (t.n / max) * 100)}%` }}
            title={`${t.n} on ${t.day}`}
          />
        ))}
      </div>
      <div className="axis">
        <span>{trend.length ? labelAt(0) : ""}</span>
        <span>{trend.length ? labelAt(Math.floor(trend.length / 2)) : ""}</span>
        <span>{trend.length ? labelAt(trend.length - 1) : ""}</span>
      </div>
      <div className="yhint">peak {max}</div>
    </div>
  );
}
