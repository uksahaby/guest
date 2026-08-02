import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { addTables, seatHousehold, autoSeat } from "./actions";
import { FloorPlan, type PlanTable } from "./FloorPlan";

/**
 * Tables and seating: the list, the floor plan, and who is still standing.
 *
 * Seats are counted from invitation_legs.table_id and nowhere else. A
 * stored "seats assigned" is a number that has to be kept in step with the
 * thing it counts, and eventually is not.
 */

type Seating = {
  leg_id: string;
  tables: (PlanTable & { households: number })[];
  unassigned: {
    id: string;
    display_name: string;
    allowance: number;
    rsvp: string;
    category: string | null;
  }[];
  totals: {
    tables: number;
    active: number;
    inactive: number;
    seats: number;
    assigned: number;
    empty: number;
    unseated_people: number;
    unseated_households: number;
  };
};

const PER_PAGE = 8;

function pct(n: number, of: number): string {
  return of > 0 ? `${((n / of) * 100).toFixed(1)}%` : "0.0%";
}

export default async function TablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    q?: string;
    page?: string;
    seated?: string;
    waiting?: string;
    error?: string;
    added?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  const { status: st, data } = await api<Seating>(`/events/${id}/seating`);
  if (st !== 200) notFound();

  const t = data.totals;
  const here = `/events/${id}/tables`;
  const tab = sp.tab === "unassigned" ? "unassigned" : "list";
  const q = (sp.q ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const filtered = q
    ? data.tables.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          (x.kind ?? "").toLowerCase().includes(q),
      )
    : data.tables;
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const shown = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const from = filtered.length === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, filtered.length);

  const occupied = t.seats > 0 ? Math.round((t.assigned / t.seats) * 100) : 0;
  const fullest = [...data.tables]
    .filter((x) => x.is_active)
    .sort((a, b) => b.assigned - a.assigned)[0];

  const ring = 2 * Math.PI * 26;
  const qs = q ? `q=${encodeURIComponent(q)}&` : "";

  const cards = [
    { label: "Total Tables", n: t.tables,
      foot: `${t.active} Active · ${t.inactive} Inactive`, tone: "",
      d: "M4 20V8l8-4 8 4v12M9 20v-6h6v6" },
    { label: "Total Seats", n: t.seats,
      foot: `${t.unseated_households} Unassigned`, tone: "mute",
      d: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" },
    { label: "Seats Assigned", n: t.assigned,
      foot: `${pct(t.assigned, t.seats)} of total`, tone: "ok",
      d: "M20 6 9 17l-5-5" },
    { label: "Empty Seats", n: t.empty,
      foot: `${pct(t.empty, t.seats)} of total`, tone: "warn",
      d: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18" },
  ];

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My Events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>Tables &amp; Seating</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">Tables &amp; Seating</h1>
          <p className="sub">
            Organise your tables, manage seating arrangements and assign guests.
          </p>
        </div>
        <div className="head-actions">
          <a className="ghost" href="#floor-plan">Floor Plan View</a>
          <form action={autoSeat}>
            <input type="hidden" name="event_id" value={id} />
            <button className="ghost" type="submit">Seating Rules</button>
          </form>
          <a className="primary" href="#add-table">+ Add Table</a>
        </div>
      </div>

      {sp.seated && (
        <div className="plan-line">
          <b>
            Seated {sp.seated}{" "}
            {sp.seated === "1" ? "household" : "households"}.
          </b>
          {sp.waiting && sp.waiting !== "0"
            ? ` ${sp.waiting} still need a table with room.`
            : " Everyone who replied yes has a seat."}
        </div>
      )}
      {sp.added && <div className="plan-line"><b>Table added.</b></div>}
      {sp.error && <p className="form-error">That didn&rsquo;t work — try again.</p>}

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
              <circle cx="32" cy="32" r="26" className="ring-track" />
              <circle cx="32" cy="32" r="26" className="ring-fill"
                strokeDasharray={`${(ring * occupied) / 100} ${ring}`}
                transform="rotate(-90 32 32)" />
            </svg>
          </span>
          <div>
            <p className="stat-label">Tables Capacity</p>
            <p className="stat-value">{occupied}%</p>
            <p className="stat-foot">Occupied</p>
          </div>
        </div>
      </div>

      <div className="grid-seating">
        <div className="card">
          <div className="tabs">
            <Link className={tab === "list" ? "on" : ""} href={here}>
              Table List
            </Link>
            <Link className={tab === "unassigned" ? "on" : ""}
              href={`${here}?tab=unassigned`}>
              Unassigned Guests ({t.unseated_households})
            </Link>
          </div>

          {tab === "list" ? (
            <>
              <form method="GET" className="filters">
                <input className="field search" type="search" name="q"
                  defaultValue={q} placeholder="Search tables…"
                  aria-label="Search tables" />
                <button className="ghost" type="submit">Filter</button>
                {q && <Link className="ghost" href={here}>Clear</Link>}
              </form>

              <div className="table-wrap">
                <table className="list guests">
                  <thead>
                    <tr>
                      <th>Table Name</th>
                      <th>Capacity</th>
                      <th>Assigned</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((x) => {
                      const left = x.capacity - x.assigned;
                      return (
                        <tr key={x.id}>
                          <td>
                            <div className="who">
                              <span className="tbl-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none"
                                  stroke="currentColor" strokeWidth="1.7"
                                  strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6" />
                                </svg>
                              </span>
                              <div>
                                <b>{x.name}</b>
                                <small>{x.kind ?? "No type"}</small>
                              </div>
                            </div>
                          </td>
                          <td className="num">{x.capacity}</td>
                          <td className="num">{x.assigned}</td>
                          <td>
                            {!x.is_active ? (
                              <span className="badge d-not_sent">Inactive</span>
                            ) : left <= 0 ? (
                              <span className="badge attending">Full</span>
                            ) : (
                              <span className="badge pending">
                                {left} Seat{left === 1 ? "" : "s"} Left
                              </span>
                            )}
                          </td>
                          <td className="right">
                            <Link className="ghost sm" href={`${here}?tab=unassigned`}>
                              Seat
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pager">
                <span className="sub">
                  Showing {from} to {to} of {filtered.length} tables
                </span>
                <div className="pages">
                  {page > 1 && (
                    <Link className="ghost sm" href={`${here}?${qs}page=${page - 1}`}>
                      ‹
                    </Link>
                  )}
                  {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                    <Link key={n} className={`pagenum${n === page ? " on" : ""}`}
                      href={`${here}?${qs}page=${n}`}>
                      {n}
                    </Link>
                  ))}
                  {page < pages && (
                    <Link className="ghost sm" href={`${here}?${qs}page=${page + 1}`}>
                      ›
                    </Link>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="sub" style={{ margin: "4px 0 14px" }}>
                Households that replied yes and have nowhere to sit. Anyone
                who has not replied is left out — chasing a table for a guest
                who never arrives is how a room gets seated twice.
              </p>
              {data.unassigned.length === 0 ? (
                <p className="sub">Everyone who replied yes has a seat.</p>
              ) : (
                <div className="table-wrap">
                  <table className="list guests">
                    <thead>
                      <tr>
                        <th>Household</th>
                        <th>Type</th>
                        <th>Seats</th>
                        <th>Put them at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unassigned.map((g) => (
                        <tr key={g.id}>
                          <td><b>{g.display_name}</b></td>
                          <td>
                            {g.category ? (
                              <span className="chip">{g.category}</span>
                            ) : (
                              <span className="none">—</span>
                            )}
                          </td>
                          <td className="num">{g.allowance}</td>
                          <td>
                            <form action={seatHousehold} className="form-row">
                              <input type="hidden" name="event_id" value={id} />
                              <input type="hidden" name="leg_id" value={data.leg_id} />
                              <input type="hidden" name="invitation_id" value={g.id} />
                              <select className="field" name="table_id"
                                defaultValue=""
                                aria-label={`Table for ${g.display_name}`}>
                                <option value="">Choose a table…</option>
                                {data.tables
                                  .filter(
                                    (x) =>
                                      x.is_active &&
                                      x.capacity - x.assigned >= g.allowance,
                                  )
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name} — {x.capacity - x.assigned} free
                                    </option>
                                  ))}
                              </select>
                              <button className="ghost sm" type="submit">Seat</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="card" id="floor-plan">
          <h2 className="card-title">Floor Plan View</h2>
          <FloorPlan tables={data.tables} />
          <ul className="plan-legend">
            <li><i className="dot ok" />Full</li>
            <li><i className="dot warn" />Has empty seats</li>
            <li><i className="dot mute" />Inactive</li>
            <li><i className="dot open" />Nobody seated</li>
          </ul>
          <form action={autoSeat}>
            <input type="hidden" name="event_id" value={id} />
            <button className="ghost wide" type="submit">
              Seat everyone who replied yes
            </button>
          </form>
        </div>
      </div>

      <div className="grid-3">
        <section className="card mini">
          <span className="stat-icon ok" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
            </svg>
          </span>
          <div>
            <strong>
              {fullest ? `Fullest table (${fullest.name})` : "No tables yet"}
            </strong>
            <small>
              {fullest
                ? `${fullest.assigned} / ${fullest.capacity} seats assigned`
                : "Add a table to start seating"}
            </small>
            <Link href={here}>View table →</Link>
          </div>
        </section>

        <section className="card mini">
          <span className="stat-icon warn" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17h.01M9.1 9a3 3 0 1 1 4.2 2.8c-.8.4-1.3 1.2-1.3 2.2" />
            </svg>
          </span>
          <div>
            <strong>Still standing</strong>
            <small>
              {t.unseated_households} household
              {t.unseated_households === 1 ? "" : "s"} with no table
              {t.unseated_people > 0 ? ` · ${t.unseated_people} people` : ""}
            </small>
            <Link href={`${here}?tab=unassigned`}>View unassigned →</Link>
          </div>
        </section>

        <section className="card mini" id="add-table">
          <span className="stat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div>
            <strong>Add a table</strong>
            <form action={addTables} className="form-row" style={{ marginTop: 8 }}>
              <input type="hidden" name="event_id" value={id} />
              <input type="hidden" name="leg_id" value={data.leg_id} />
              <input className="field" name="name" placeholder="Table 13"
                aria-label="Table name" required />
              <input className="field narrow" name="capacity" type="number"
                min={1} defaultValue={10} aria-label="Seats" />
              <button className="primary" type="submit">Add</button>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
