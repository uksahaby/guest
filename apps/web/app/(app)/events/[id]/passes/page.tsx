import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { generatePasses } from "./actions";

/**
 * QR passes.
 *
 * A pass exists for every household from the moment it is imported: the QR
 * is derived from the pass id and the event's signing key, so there is no
 * image to create and nothing to lose. What these states track is the
 * LINK — the thing a guest actually receives.
 *
 * That is why "Generate" does not mean "make a QR". It means "mint the
 * link", which is also the moment a pass counts against the plan.
 */

type Row = {
  id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  category: string | null;
  table_name: string | null;
  allowance: number;
  pass_id: string | null;
  generated: boolean;
  sent: boolean;
  opened: boolean;
  checked_in_at: string | null;
};

type Payload = {
  rows: Row[];
  total: number;
  counts: {
    total: number;
    generated: number;
    sent: number;
    checked_in: number;
    not_checked_in: number;
    pending: number;
    not_sent: number;
  };
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

/** 1 2 3 4 5 … last, as the mockup shows it. */
function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | null)[] = [1, 2, 3, 4, 5].filter((n) => n <= pages);
  if (page > 5 && page < pages) out.push(null, page);
  else out.push(null);
  out.push(pages);
  return out;
}

const SLICE = ["#2f6b1c", "#c62828", "#e0a63a", "#8a9187"];

export default async function PassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    table?: string;
    category?: string;
    page?: string;
    generated?: string;
    error?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status: est, data: event } = await api<EventShape>(`/events/${id}`);
  if (est !== 200) notFound();

  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * PER_PAGE;

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (sp.status) query.set("status", sp.status);
  if (sp.table) query.set("table", sp.table);
  if (sp.category) query.set("category", sp.category);
  query.set("limit", String(PER_PAGE));
  query.set("offset", String(offset));

  const { data } = await api<Payload>(`/events/${id}/passes?${query.toString()}`);
  const c = data.counts;

  const here = `/events/${id}/passes`;
  const base = {
    q: q || undefined,
    status: sp.status,
    table: sp.table,
    category: sp.category,
  };
  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  const from = data.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PER_PAGE, data.total);

  const pct = (n: number) =>
    c.total > 0 ? `${((n / c.total) * 100).toFixed(1)}%` : "0.0%";

  const fmt = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  });

  const cards = [
    { key: undefined, label: "Total Passes", n: c.total, foot: "For all guests",
      tone: "", d: "M4 8V5h3m10 0h3v3M4 16v3h3m13-3v3h-3M8 12h8" },
    { key: "generated", label: "Generated", n: c.generated, foot: `${pct(c.generated)} of total`,
      tone: "ok", d: "M20 6 9 17l-5-5" },
    { key: "sent", label: "Sent", n: c.sent, foot: `${pct(c.sent)} of total`,
      tone: "mute", d: "M22 2 11 13M22 2l-7 20-4-9-9-4z" },
    { key: "checked_in", label: "Checked In", n: c.checked_in, foot: `${pct(c.checked_in)} of total`,
      tone: "ok", d: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" },
    { key: "not_checked_in", label: "Not Checked In", n: c.not_checked_in, foot: `${pct(c.not_checked_in)} of total`,
      tone: "warn", d: "M12 15v2m0-9a3 3 0 0 1 3 3v2H9v-2a3 3 0 0 1 3-3zM5 11h14v10H5z" },
  ];

  const donut = [
    { label: "Checked In", n: c.checked_in },
    { label: "Not Checked In", n: c.not_checked_in - c.pending - c.not_sent },
    { label: "Pending", n: c.pending },
    { label: "Not Sent", n: c.not_sent },
  ].map((d) => ({ ...d, n: Math.max(0, d.n) }));
  const donutTotal = donut.reduce((n, d) => n + d.n, 0) || 1;
  const R = 46;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My Events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>QR Passes</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">QR Passes</h1>
          <p className="sub">
            Create, manage and share QR passes for guest check-in.
          </p>
        </div>
        <div className="head-actions">
          <Link className="ghost" href={`/events/${id}/settings`}>
            QR Pass Settings
          </Link>
          <Link className="ghost" href={`${here}?status=generated`}>
            Preview Pass
          </Link>
          <form action={generatePasses}>
            <input type="hidden" name="event_id" value={id} />
            <button className="primary" type="submit">Generate QR Passes</button>
          </form>
        </div>
      </div>

      {sp.generated && (
        <div className="plan-line">
          <b>
            {sp.generated === "0"
              ? "Every household already has a link."
              : `Generated ${sp.generated} link${sp.generated === "1" ? "" : "s"}.`}
          </b>
        </div>
      )}
      {sp.error && (
        <p className="form-error">
          {sp.error === "limit_reached"
            ? "That would take the event past its plan limit. Upgrade to issue more passes."
            : "That didn't work — try again."}
        </p>
      )}

      <div className="stats five">
        {cards.map((card) => {
          const on = (sp.status ?? "") === (card.key ?? "");
          return (
            <Link
              key={card.label}
              href={`${here}${withParams(base, { status: card.key, page: undefined })}`}
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
                <p className="stat-foot">{card.foot}</p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid-side">
        <div className="card">
          <form method="GET" className="filters">
            <input className="field search" type="search" name="q" defaultValue={q}
              placeholder="Search by name, email or phone…" aria-label="Search" />
            <select className="field" name="status" defaultValue={sp.status ?? ""}
              aria-label="Pass status">
              <option value="">Pass Status: All</option>
              <option value="not_sent">Not Sent</option>
              <option value="generated">Generated</option>
              <option value="sent">Sent</option>
              <option value="opened">Opened</option>
              <option value="checked_in">Checked In</option>
              <option value="not_checked_in">Not Checked In</option>
            </select>
            <select className="field" name="table" defaultValue={sp.table ?? ""}
              aria-label="Table">
              <option value="">Table: All</option>
              {data.tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="field" name="category" defaultValue={sp.category ?? ""}
              aria-label="Guest type">
              <option value="">Guest Type: All</option>
              {data.categories.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <button className="ghost" type="submit">Filters</button>
            {(q || sp.status || sp.table || sp.category) && (
              <Link className="ghost" href={here}>Clear</Link>
            )}
          </form>

          {data.rows.length === 0 ? (
            <p className="sub" style={{ padding: "20px 0" }}>
              No households match those filters.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="list guests">
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Guest Type</th>
                    <th>Table</th>
                    <th>Pass Status</th>
                    <th>QR Code</th>
                    <th>Checked In</th>
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
                        {r.category
                          ? <span className="chip">{r.category}</span>
                          : <span className="none">—</span>}
                      </td>
                      <td>{r.table_name ?? <span className="none">—</span>}</td>
                      <td>
                        {r.opened ? (
                          <span className="badge d-opened">Opened</span>
                        ) : r.sent ? (
                          <span className="badge d-sent">Sent</span>
                        ) : r.generated ? (
                          <span className="badge d-link_generated">Generated</span>
                        ) : (
                          <span className="badge d-not_sent">Not Sent</span>
                        )}
                      </td>
                      <td>
                        {r.generated ? (
                          <Link className="qr-view"
                            href={`/events/${id}/guests/${r.id}/link`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="1.7" strokeLinecap="round"
                              strokeLinejoin="round" aria-hidden="true">
                              <path d="M4 8V5h3m10 0h3v3M4 16v3h3m13-3v3h-3M8 12h8" />
                            </svg>
                            View
                          </Link>
                        ) : (
                          <span className="none">—</span>
                        )}
                      </td>
                      <td>
                        {r.checked_in_at ? (
                          <span className="checked yes">
                            <b>Yes</b>
                            <small>{fmt.format(new Date(r.checked_in_at))}</small>
                          </span>
                        ) : (
                          <span className="checked no">
                            <b>No</b>
                            <small>Not checked in</small>
                          </span>
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
                    href={`${here}${withParams(base, { page: String(page - 1) })}`}>‹</Link>
                )}
                {pageNumbers(page, pages).map((n, i) =>
                  n === null ? (
                    <span key={`gap-${i}`} className="sub">…</span>
                  ) : (
                    <Link key={n} className={`pagenum${n === page ? " on" : ""}`}
                      href={`${here}${withParams(base, { page: String(n) })}`}>{n}</Link>
                  ),
                )}
                {page < pages && (
                  <Link className="ghost sm"
                    href={`${here}${withParams(base, { page: String(page + 1) })}`}>›</Link>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="rail">
          <section className="card">
            <h2 className="card-title">QR Pass Overview</h2>
            <div className="donut-row">
              <div className="ring small">
                <svg viewBox="0 0 128 128" role="img"
                  aria-label={`${c.total} passes by state`}>
                  <circle cx="64" cy="64" r={R} className="ring-track" />
                  {donut.map((d, i) => {
                    const len = (d.n / donutTotal) * CIRC;
                    const el = (
                      <circle key={d.label} cx="64" cy="64" r={R} className="slice"
                        stroke={SLICE[i]} strokeDasharray={`${len} ${CIRC}`}
                        strokeDashoffset={-acc} transform="rotate(-90 64 64)" />
                    );
                    acc += len;
                    return el;
                  })}
                </svg>
                <div className="ring-mid">
                  <strong>{c.total}</strong>
                  <small>Total Passes</small>
                </div>
              </div>
              <ul className="legend">
                {donut.map((d, i) => (
                  <li key={d.label}>
                    <i className="dot" style={{ background: SLICE[i] }} />
                    <span className="lbl">{d.label}</span>
                    <b>{d.n} ({((d.n / donutTotal) * 100).toFixed(1)}%)</b>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">Quick Actions</h2>
            <ul className="actions">
              <li>
                <form action={generatePasses}>
                  <input type="hidden" name="event_id" value={id} />
                  <button type="submit" className="action-btn">
                    <strong>Generate QR Passes</strong>
                    <small>Mint a link for every household without one</small>
                  </button>
                </form>
              </li>
              <li>
                <Link href={`${here}?status=generated`}>
                  <strong>Send QR Passes</strong>
                  <small>Links ready to share on WhatsApp</small>
                </Link>
              </li>
              <li>
                <Link href={`/events/${id}/report/export`}>
                  <strong>Download guest list</strong>
                  <small>CSV with every household and its state</small>
                </Link>
              </li>
              <li>
                <Link href={`${here}?status=not_checked_in`}>
                  <strong>Who has not arrived</strong>
                  <small>Passes with no check-in yet</small>
                </Link>
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 className="card-title">Need help?</h2>
            <p className="sub">
              A pass is the QR on a guest&rsquo;s phone. You share the link,
              they open it, and an usher scans it at the gate.
            </p>
            <Link className="ghost wide" href={`/events/${id}/team`}
              style={{ marginTop: 12 }}>
              Set up the gate →
            </Link>
          </section>
        </aside>
      </div>

      <div className="grid-3">
        <section className="card mini">
          <span className="stat-icon ok" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
          <div>
            <strong>Secure &amp; unique</strong>
            <small>
              Every pass is signed with this event&rsquo;s own key, so a
              copied or invented code is refused at the gate.
            </small>
          </div>
        </section>

        <section className="card mini">
          <span className="stat-icon warn" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" />
            </svg>
          </span>
          <div>
            <strong>Works with no signal</strong>
            <small>
              The scanner verifies a pass on the phone itself and queues the
              check-in, so a venue with no bars still admits guests.
            </small>
          </div>
        </section>

        <section className="card mini">
          <span className="stat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3h10v18H7zM11 18h2" />
            </svg>
          </span>
          <div>
            <strong>Phone or paper</strong>
            <small>
              Guests can show the QR on their phone or bring a printed copy —
              both scan the same.
            </small>
          </div>
        </section>
      </div>
    </>
  );
}
