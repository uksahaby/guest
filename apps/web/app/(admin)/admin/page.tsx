import Link from "next/link";
import { api } from "@/lib/org-api";
import { AdminIcon } from "./nav";

/**
 * The platform dashboard, to the mockup.
 *
 * Every number on it is measured. Where the design shows something this
 * system cannot know — storage used, bandwidth used, an "active
 * integrations 23/28" counter — it is absent rather than invented, because
 * a dashboard whose figures are decorative is worse than no dashboard: it
 * teaches you to stop trusting the ones that are real.
 *
 * The chart is a server-rendered SVG. No charting library, matching the
 * histogram on the organiser's report screen — the data is one series of
 * daily totals and the whole thing is a polyline and a filled path.
 */

type Overview = {
  period_days: number;
  totals: {
    organisers: { value: number; change: number | null };
    events: { value: number; change: number | null };
    users: { value: number; change: number | null };
    revenue_minor: number;
    revenue: string;
    revenue_change: number | null;
  };
  revenue_series: { day: string; amount_minor: number }[];
  events_by_status: {
    total: number;
    upcoming: number;
    ongoing: number;
    completed: number;
    cancelled: number;
    draft: number;
  };
  top_organisers: {
    id: string;
    name: string;
    is_implicit: boolean;
    events: number;
    people: number;
    revenue: string;
    revenue_minor: number;
  }[];
  transactions: {
    id: string;
    reference: string;
    organiser: string;
    plan: string;
    amount: string;
    status: string;
    at: string;
  }[];
  activity: { kind: string; subject: string; detail: string | null; at: string }[];
  health: { name: string; state: string; detail: string }[];
};

const naira = (minor: number) => `₦${(minor / 100).toLocaleString("en-NG")}`;

function day(iso: string, withYear = false): string {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const d = Math.round(hrs / 24);
  return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : day(iso, true);
}

/** "+12.5%" / "−3.1%" / nothing at all when there is no earlier period. */
function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="chg none">no earlier period</span>;
  const up = pct >= 0;
  return (
    <span className={`chg${up ? " up" : " down"}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={up ? "M5 19 19 5M11 5h8v8" : "M5 5l14 14M19 11v8h-8"} />
      </svg>
      {Math.abs(pct)}%
    </span>
  );
}

/**
 * The revenue line. A polyline over a filled area, with a dot per day, on
 * a 0..max scale whose top is rounded up so the axis labels are round
 * numbers rather than whatever the maximum happened to be.
 */
function RevenueChart({ series }: { series: { day: string; amount_minor: number }[] }) {
  const W = 640;
  const H = 190;
  const PAD_L = 48;
  const PAD_B = 24;
  const PAD_T = 10;

  const values = series.map((p) => p.amount_minor);
  const rawMax = Math.max(1, ...values);
  // Round the ceiling up to something a person would choose.
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / step) * step;

  const innerW = W - PAD_L - 8;
  const innerH = H - PAD_B - PAD_T;
  const x = (i: number) =>
    PAD_L + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH;

  const line = series.map((p, i) => `${x(i)},${y(p.amount_minor)}`).join(" ");
  const area =
    `M ${x(0)},${PAD_T + innerH} ` +
    series.map((p, i) => `L ${x(i)},${y(p.amount_minor)}`).join(" ") +
    ` L ${x(series.length - 1)},${PAD_T + innerH} Z`;

  // Four gridlines, labelled in whole naira.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Never more than six date labels, however long the period.
  const every = Math.max(1, Math.ceil(series.length / 6));

  return (
    <svg className="revchart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Revenue per day, peaking at ${naira(rawMax)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD_L} x2={W - 8} y1={y(t)} y2={y(t)} />
          <text className="axis" x={PAD_L - 8} y={y(t) + 3.5} textAnchor="end">
            {t === 0 ? "₦0" : `₦${Math.round(t / 100 / 1000)}k`}
          </text>
        </g>
      ))}

      <path className="area" d={area} />
      <polyline className="line" points={line} />

      {series.map((p, i) => (
        <circle key={p.day} className="dot" cx={x(i)} cy={y(p.amount_minor)} r="2.6">
          <title>{`${day(p.day)} — ${naira(p.amount_minor)}`}</title>
        </circle>
      ))}

      {series.map((p, i) =>
        i % every === 0 || i === series.length - 1 ? (
          <text key={`t${p.day}`} className="axis" x={x(i)} y={H - 6} textAnchor="middle">
            {day(p.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Events by status, as a ring with the total in the middle. */
function StatusRing({ s }: { s: Overview["events_by_status"] }) {
  const slices = [
    { key: "upcoming", label: "Upcoming", n: s.upcoming, colour: "#2e7d32" },
    { key: "ongoing", label: "Ongoing", n: s.ongoing, colour: "#2f5fbf" },
    { key: "completed", label: "Completed", n: s.completed, colour: "#7a52c7" },
    { key: "draft", label: "Draft", n: s.draft, colour: "#8a9187" },
    { key: "cancelled", label: "Cancelled", n: s.cancelled, colour: "#e0a63a" },
  ].filter((x) => x.n > 0);

  const total = s.total || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="ringwrap">
      <svg viewBox="0 0 140 140" className="ring-svg" role="img"
        aria-label={`${s.total} events by status`}>
        <circle cx="70" cy="70" r={R} className="ring-bg" />
        {slices.map((sl) => {
          const len = (sl.n / total) * C;
          const el = (
            <circle
              key={sl.key}
              cx="70" cy="70" r={R}
              stroke={sl.colour}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              className="ring-slice"
            />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="66" className="ring-n" textAnchor="middle">{s.total}</text>
        <text x="70" y="84" className="ring-l" textAnchor="middle">Total</text>
      </svg>

      <ul className="ringkey">
        {slices.map((sl) => (
          <li key={sl.key}>
            <span className="swatch" style={{ background: sl.colour }} />
            <span className="k">{sl.label}</span>
            <span className="v">
              {sl.n.toLocaleString("en-NG")}{" "}
              <small>({Math.round((sl.n / total) * 1000) / 10}%)</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACTIVITY_ICON: Record<string, string> = {
  organiser: "users", event: "calendar", payment: "card",
};

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = ["7", "30", "90", "365"].includes(sp.days ?? "") ? sp.days! : "30";

  const { data: o } = await api<Overview>(`/admin/overview?days=${days}`);
  const t = o.totals;
  const from = new Date(Date.now() - Number(days) * 24 * 3600 * 1000);

  const cards = [
    { label: "Total organisers", value: t.organisers.value.toLocaleString("en-NG"),
      change: t.organisers.change, icon: "users", tone: "a" },
    { label: "Total events", value: t.events.value.toLocaleString("en-NG"),
      change: t.events.change, icon: "calendar", tone: "b" },
    { label: "Total users", value: t.users.value.toLocaleString("en-NG"),
      change: t.users.change, icon: "user", tone: "c" },
    { label: "Total revenue", value: t.revenue,
      change: t.revenue_change, icon: "bank", tone: "d" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page">Dashboard</h1>
          <p className="sub" style={{ marginTop: 2 }}>
            Overview of the platform and key metrics.
          </p>
        </div>
        <nav className="range" aria-label="Period">
          {[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]].map(
            ([v, label]) => (
              <Link key={v} href={`/admin?days=${v}`} className={v === days ? "on" : undefined}>
                {label}
              </Link>
            ),
          )}
        </nav>
      </div>

      <p className="sub sm" style={{ marginTop: -8, marginBottom: 14 }}>
        {day(from.toISOString(), true)} – {day(new Date().toISOString(), true)}
        {" · "}changes compare with the {days} days before that.
      </p>

      <div className="statgrid">
        {cards.map((c) => (
          <div className={`card adminstat tone-${c.tone}`} key={c.label}>
            <span className="stat-icon"><AdminIcon name={c.icon} /></span>
            <div>
              <div className="stat-label">{c.label}</div>
              <div className="stat-value">{c.value}</div>
              <Change pct={c.change} />
            </div>
          </div>
        ))}
      </div>

      <div className="admingrid">
        <div className="card">
          <div className="setcard-head">
            <div>
              <h2>Revenue overview</h2>
              <p className="t-sub">Successful payments, per day.</p>
            </div>
            <div className="revtotal">
              <strong>{t.revenue}</strong>
              <Change pct={t.revenue_change} />
            </div>
          </div>
          {o.revenue_series.some((p) => p.amount_minor > 0) ? (
            <RevenueChart series={o.revenue_series} />
          ) : (
            <p className="empty">
              No payments in this period. The chart appears with the first one.
            </p>
          )}
        </div>

        <div className="card">
          <div className="setcard-head">
            <div>
              <h2>Events by status</h2>
              <p className="t-sub">
                Upcoming and ongoing come from the first ceremony&rsquo;s date,
                not the stored status.
              </p>
            </div>
          </div>
          <StatusRing s={o.events_by_status} />
        </div>

        <div className="card">
          <div className="setcard-head">
            <div><h2>System health</h2></div>
          </div>
          <ul className="healthlist">
            {o.health.map((h) => (
              <li key={h.name}>
                <div>
                  <strong>{h.name}</strong>
                  <small>{h.detail}</small>
                </div>
                <span className={`hstate ${h.state}`}>
                  {h.state === "operational" ? "Operational"
                    : h.state === "not_configured" ? "Not configured" : "Not built"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="setcard-head">
            <div>
              <h2>Top organisers</h2>
              <p className="t-sub">By revenue. People counted, never named.</p>
            </div>
          </div>
          {o.top_organisers.length === 0 ? (
            <p className="empty">No organisers yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr><th>Organiser</th><th>Events</th><th>People</th><th>Revenue</th></tr>
                </thead>
                <tbody>
                  {o.top_organisers.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <div className="t-name">{w.name}</div>
                        {w.is_implicit && <div className="t-sub">Personal workspace</div>}
                      </td>
                      <td>{w.events}</td>
                      <td>{w.people.toLocaleString("en-NG")}</td>
                      <td>{w.revenue_minor > 0 ? w.revenue : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="setcard-head">
            <div>
              <h2>Recent transactions</h2>
              <p className="t-sub">Every attempt, successful or not.</p>
            </div>
          </div>
          {o.transactions.length === 0 ? (
            <p className="empty">Nothing has been charged yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr><th>Reference</th><th>Organiser</th><th>Amount</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {o.transactions.map((p) => (
                    <tr key={p.id}>
                      <td><code>{p.reference}</code></td>
                      <td className="t-name">{p.organiser}</td>
                      <td>{p.amount}</td>
                      <td>
                        <span className={`badge ${p.status === "successful" ? "attending"
                          : p.status === "failed" ? "declined" : "pending"}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="setcard-head">
            <div>
              <h2>Recent activity</h2>
              <p className="t-sub">
                Assembled from what happened — there is no audit log yet.
              </p>
            </div>
          </div>
          {o.activity.length === 0 ? (
            <p className="empty">Nothing has happened yet.</p>
          ) : (
            <ul className="feedlist">
              {o.activity.map((a, i) => (
                <li key={`${a.kind}-${a.at}-${i}`}>
                  <span className={`fic ${a.kind}`}>
                    <AdminIcon name={ACTIVITY_ICON[a.kind] ?? "list"} />
                  </span>
                  <div>
                    <strong>
                      {a.kind === "organiser" ? "New organiser registered"
                        : a.kind === "event" ? "Event created"
                          : "Payment received"}
                    </strong>
                    <small>
                      {a.kind === "payment" && a.detail
                        ? `${a.detail} from ${a.subject}`
                        : a.detail ? `${a.subject} · ${a.detail}` : a.subject}
                    </small>
                  </div>
                  <span className="fwhen">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* The mockup's Quick Actions. Each one goes to the section that owns
          it, so a link never lies about where it lands — several of those
          sections are still explaining themselves rather than doing the
          job, and the page they open says so.

          Platform Usage, which the mockup puts beside this, is absent on
          purpose: nothing measures storage or bandwidth, and a progress bar
          reading "256 GB of 1 TB" would be a decoration presented as a
          fact. */}
      <div className="card">
        <div className="setcard-head">
          <div>
            <h2>Quick actions</h2>
            <p className="t-sub">The things an administrator reaches for.</p>
          </div>
        </div>
        <div className="quickgrid">
          {[
            { label: "Organisers", href: "/admin/organizers", icon: "users" },
            { label: "All events", href: "/admin/events", icon: "calendar" },
            { label: "Users", href: "/admin/users", icon: "user" },
            { label: "Transactions", href: "/admin/transactions", icon: "card" },
            { label: "Announcements", href: "/admin/announcements", icon: "megaphone" },
            { label: "System settings", href: "/admin/settings", icon: "cog" },
          ].map((q) => (
            <Link className="quick" href={q.href} key={q.href}>
              <span><AdminIcon name={q.icon} /></span>
              {q.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
