import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape, type InvitationRow } from "@/lib/org-api";
import { addHousehold } from "../../actions";

/**
 * The guest list.
 *
 * One row per HOUSEHOLD, not per person — "Mr & Mrs Adeyemi, admits 4" is
 * one row. That is the unit the product is built on: a Nigerian guest list
 * arrives as households, naming individuals is optional and usually
 * skipped, and an invitation admits a party rather than a person. A
 * per-person table would be mostly invented names beside a count nobody
 * typed.
 *
 * "Pending" and "No response" look like one thing and are two. Someone who
 * opened their invitation and did not reply needs a nudge; someone who
 * never opened it may never have received it. Different jobs, so they get
 * different filters.
 */

type ListResponse = {
  data: InvitationRow[];
  total: number;
  limit: number;
  offset: number;
  counts: {
    households: number;
    people: number;
    confirmed: number;
    declined: number;
    pending: number;
    no_response: number;
  };
  categories: string[];
  tables: string[];
};

const PER_PAGE = 25;

function pct(n: number, of: number): string {
  return of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "—";
}

/** Changes one filter and keeps the rest. */
function withParams(
  base: Record<string, string | undefined>,
  change: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * The surname's first letter.
 *
 * Stripping titles from the front does not work: "Chief & Mrs Chukwu"
 * loses "Chief &" and lands on "Mrs", so the avatar reads M. The last word
 * is the family name in every shape these lists take, and the family name
 * is what the usher says out loud.
 */
function initial(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[A-Za-zÀ-ɏ]/.test(w));
  const last = words[words.length - 1] ?? name;
  return last.slice(0, 1).toUpperCase();
}

export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    q?: string;
    imported?: string;
    skipped?: string;
    rsvp?: string;
    category?: string;
    table?: string;
    page?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();
  const leg = event.legs[0];

  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * PER_PAGE;

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (sp.rsvp) query.set("rsvp", sp.rsvp);
  if (sp.category) query.set("category", sp.category);
  if (sp.table) query.set("table", sp.table);
  query.set("limit", String(PER_PAGE));
  query.set("offset", String(offset));

  const { data: list } = await api<ListResponse>(
    `/events/${id}/invitations?${query.toString()}`,
  );

  const c = list.counts;
  const base = {
    q: q || undefined,
    rsvp: sp.rsvp,
    category: sp.category,
    table: sp.table,
  };
  const here = `/events/${id}/guests`;
  const pages = Math.max(1, Math.ceil(list.total / PER_PAGE));
  const from = list.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PER_PAGE, list.total);

  const cards: {
    key?: string;
    label: string;
    n: number;
    foot: string;
    tone: string;
  }[] = [
    { label: "Total guests", n: c.people, foot: `${c.households} households`, tone: "" },
    { key: "confirmed", label: "Confirmed", n: c.confirmed, foot: pct(c.confirmed, c.households), tone: "ok" },
    { key: "pending", label: "Pending", n: c.pending, foot: pct(c.pending, c.households), tone: "warn" },
    { key: "declined", label: "Declined", n: c.declined, foot: pct(c.declined, c.households), tone: "err" },
    { key: "no_response", label: "No response", n: c.no_response, foot: pct(c.no_response, c.households), tone: "mute" },
  ];

  const icon: Record<string, string> = {
    confirmed: "M20 6 9 17l-5-5",
    pending: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    declined: "M15 9l-6 6m0-6 6 6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    no_response: "M12 17h.01M9.1 9a3 3 0 1 1 4.2 2.8c-.8.4-1.3 1.2-1.3 2.2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    total: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  };

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>Guests</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">Guests</h1>
          <p className="sub">
            One row per household — RSVP, table and check-in for each.
          </p>
        </div>
        <div className="head-actions">
          <Link className="ghost" href={`/events/${id}/guests/import`}>
            Import guest list
          </Link>
          <a className="ghost" href={`/events/${id}/report/export`}>
            Export
          </a>
        </div>
      </div>

      {sp.imported && (
        <div className="plan-line">
          <b>
            Imported {sp.imported}{" "}
            {sp.imported === "1" ? "household" : "households"}.
          </b>
          {sp.skipped && sp.skipped !== "0" ? ` ${sp.skipped} skipped.` : ""}
        </div>
      )}
      {sp.error && (
        <p className="form-error">
          {sp.error === "missing"
            ? "A household needs a name."
            : "That didn't save — try again."}
        </p>
      )}

      {/* The cards are the filters. Each says what clicking it would give,
          so the numbers are event-wide rather than page-wide. */}
      <div className="stats five">
        {cards.map((card) => {
          const on = (sp.rsvp ?? "") === (card.key ?? "");
          return (
            <Link
              key={card.label}
              href={`${here}${withParams(base, { rsvp: card.key, page: undefined })}`}
              className={`card stat filter${on ? " on" : ""}`}
            >
              <span className={`stat-icon ${card.tone}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icon[card.key ?? "total"]} />
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

      <div className="card">
        {/* GET, so a filtered list is a URL you can bookmark or send to
            whoever is chasing the replies. */}
        <form method="GET" className="filters">
          <input
            className="field search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name, phone or email…"
            aria-label="Search guests"
          />
          <select className="field" name="rsvp" defaultValue={sp.rsvp ?? ""}
            aria-label="RSVP status">
            <option value="">Any RSVP</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="declined">Declined</option>
            <option value="no_response">No response</option>
          </select>
          <select className="field" name="category" defaultValue={sp.category ?? ""}
            aria-label="Guest type">
            <option value="">Any type</option>
            {list.categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select className="field" name="table" defaultValue={sp.table ?? ""}
            aria-label="Table">
            <option value="">Any table</option>
            {list.tables.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button className="ghost" type="submit">Apply</button>
          {(q || sp.rsvp || sp.category || sp.table) && (
            <Link className="ghost" href={here}>Clear</Link>
          )}
        </form>

        {list.data.length === 0 ? (
          <p className="sub" style={{ padding: "20px 0" }}>
            {q || sp.rsvp || sp.category || sp.table
              ? "No households match those filters."
              : "No households yet. The list is always free to build."}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="list guests">
              <thead>
                <tr>
                  <th>Household</th>
                  <th>Phone</th>
                  <th>Type</th>
                  <th>RSVP</th>
                  <th>Table</th>
                  <th>Invitation</th>
                  <th>Check-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((row) => {
                  const l = row.legs[0];
                  const admitted = l?.admitted ?? 0;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="who">
                          <span className="avatar" aria-hidden="true">
                            {initial(row.display_name)}
                          </span>
                          <div>
                            <b>{row.display_name}</b>
                            <small>
                              admits {l?.allowance ?? 0}
                              {row.named_count > 0
                                ? ` · ${row.named_count} named`
                                : ""}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="mono">
                        {row.primary_phone ?? <span className="none">—</span>}
                      </td>
                      <td>
                        {row.category ? (
                          <span className="chip">{row.category}</span>
                        ) : (
                          <span className="none">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${l?.rsvp ?? "pending"}`}>
                          {l?.rsvp === "partial"
                            ? `${l.rsvp_count} of ${l.allowance}`
                            : l?.rsvp === "attending"
                              ? "Confirmed"
                              : l?.rsvp === "declined"
                                ? "Declined"
                                : row.delivery_state === "opened"
                                  ? "Pending"
                                  : "No response"}
                        </span>
                      </td>
                      <td>{l?.table_name ?? <span className="none">—</span>}</td>
                      <td>
                        <span className={`badge d-${row.delivery_state}`}>
                          {row.delivery_state === "not_sent"
                            ? "Not sent"
                            : row.delivery_state === "link_generated"
                              ? "Link ready"
                              : row.delivery_state === "opened"
                                ? "Opened"
                                : "Sent"}
                        </span>
                      </td>
                      <td>
                        {admitted > 0 ? (
                          <span className="badge attending">{admitted} in</span>
                        ) : (
                          <span className="none">Not yet</span>
                        )}
                      </td>
                      <td className="right">
                        <Link
                          className="ghost sm"
                          href={`/events/${id}/guests/${row.id}/link`}
                        >
                          Invitation
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {list.total > 0 && (
          <div className="pager">
            <span className="sub">
              Showing {from}–{to} of {list.total.toLocaleString("en-NG")}
            </span>
            <div className="pages">
              {page > 1 && (
                <Link
                  className="ghost sm"
                  href={`${here}${withParams(base, { page: String(page - 1) })}`}
                >
                  ‹ Previous
                </Link>
              )}
              <span className="sub">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <Link
                  className="ghost sm"
                  href={`${here}${withParams(base, { page: String(page + 1) })}`}
                >
                  Next ›
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      <details className="card add-block">
        <summary>Add a household by hand</summary>
        <form action={addHousehold}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="leg_id" value={leg?.id ?? ""} />
          <div className="form-row">
            <input
              className="field"
              name="display_name"
              placeholder="Mr &amp; Mrs Adeyemi"
              required
              aria-label="Household name"
            />
            <input
              className="field"
              name="phone"
              placeholder="+234 803 411 2098"
              aria-label="Phone"
            />
            <input
              className="field narrow"
              name="allowance"
              type="number"
              min={1}
              defaultValue={2}
              aria-label="Party size"
            />
            <button className="primary" type="submit">
              Add
            </button>
          </div>
        </form>
      </details>
    </>
  );
}
