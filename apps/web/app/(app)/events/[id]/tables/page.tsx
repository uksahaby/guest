import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { addTables, removeTable, renameTable, seatHousehold } from "./actions";

/**
 * Seating, per the Tables view in mockups/event-workspace.html: a card per
 * table with "8 of 10 seats", an occupancy bar, and who is on it — plus an
 * amber strip for the households still without a seat.
 *
 * A seat is a person, so a household of four takes four of them.
 */

type Seating = {
  leg_id: string;
  tables: {
    id: string;
    name: string;
    capacity: number;
    seats_used: number;
    households: number;
    who: string[];
    over_capacity: boolean;
  }[];
  total_tables: number;
  total_capacity: number;
  seated_people: number;
  unseated_households: number;
  unseated_people: number;
};

type Unseated = {
  data: {
    invitation_id: string;
    display_name: string;
    allowance: number;
    category: string | null;
    rsvp: string;
  }[];
};

const ERRORS: Record<string, string> = {
  bad_capacity: "Seats per table must be between 1 and 100.",
  bad_count: "Create between 1 and 500 tables at a time.",
  too_many_tables: "That would be more than 500 tables at this part of the event.",
  wrong_leg_table: "That table belongs to a different part of the event.",
  not_invited: "That household isn't invited to this part of the event.",
  failed: "That didn't save — try again.",
};

export default async function TablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; leg?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  // Seating is per leg. Single-leg events — the common case — never see a
  // switcher, per the handoff's rule that the UI mustn't say "leg".
  const leg = event.legs.find((l) => l.id === sp.leg) ?? event.legs[0];
  if (!leg) notFound();

  const [{ data: plan }, { data: unseated }] = await Promise.all([
    api<Seating>(`/legs/${leg.id}/tables`),
    api<Unseated>(`/legs/${leg.id}/unseated`),
  ]);

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {event.name}
        </Link>
      </p>
      <h1 className="page">Tables</h1>
      <p className="sub">
        {plan.total_tables === 0
          ? "No tables yet. Add a run of them and seat households by party — a family of four takes four seats."
          : `${plan.total_tables} tables · ${plan.total_capacity} seats · ${plan.seated_people} seated.`}
      </p>

      {event.legs.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {event.legs.map((l) => (
            <Link
              key={l.id}
              className={l.id === leg.id ? "primary" : "ghost"}
              href={`/events/${id}/tables?leg=${l.id}`}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}

      {sp.error && <p className="form-error">{ERRORS[sp.error] ?? ERRORS.failed}</p>}

      {plan.unseated_households > 0 && (
        <div className="unassigned">
          <div>
            <div className="t">
              {plan.unseated_households}{" "}
              {plan.unseated_households === 1 ? "household has" : "households have"} no
              table
            </div>
            <div className="s">
              {plan.unseated_people}{" "}
              {plan.unseated_people === 1 ? "person" : "people"} to seat. Nobody is
              turned away over a table — this only affects place cards.
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Add tables</h2>
        <form action={addTables}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="leg_id" value={leg.id} />
          <div className="form-row">
            <input
              className="field narrow"
              name="count"
              type="number"
              min={1}
              max={500}
              defaultValue={10}
              aria-label="How many tables"
            />
            <input
              className="field narrow"
              name="capacity"
              type="number"
              min={1}
              max={100}
              defaultValue={10}
              aria-label="Seats per table"
            />
            <button className="primary" type="submit">
              Add numbered tables
            </button>
          </div>
        </form>
        <form action={addTables} style={{ marginTop: 10 }}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="leg_id" value={leg.id} />
          <div className="form-row">
            <input className="field" name="name" placeholder="VIP Table" required />
            <input
              className="field narrow"
              name="capacity"
              type="number"
              min={1}
              max={100}
              defaultValue={10}
              aria-label="Seats"
            />
            <button className="ghost" type="submit">
              Add one named table
            </button>
          </div>
        </form>
      </div>

      {plan.tables.length > 0 && (
        <div className="tgrid">
          {plan.tables.map((t) => {
            const pct = Math.min(100, Math.round((t.seats_used / t.capacity) * 100));
            const shown = t.who.slice(0, 3);
            const more = t.who.length - shown.length;
            return (
              <div className="tcard" key={t.id}>
                <h3>{t.name}</h3>
                <div className="occ">
                  {t.seats_used} of {t.capacity} seats
                  {t.over_capacity ? " · over" : ""}
                </div>
                <div className="bar">
                  <i
                    className={t.over_capacity ? "over" : t.seats_used >= t.capacity ? "full" : ""}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="who">
                  {t.who.length === 0 ? "Empty" : shown.join(" · ")}
                  {more > 0 ? ` +${more}` : ""}
                </div>
                <details className="tedit">
                  <summary>Edit</summary>
                  <form action={renameTable} style={{ marginTop: 10 }}>
                    <input type="hidden" name="event_id" value={id} />
                    <input type="hidden" name="table_id" value={t.id} />
                    <div className="form-row">
                      <input
                        className="field"
                        name="name"
                        defaultValue={t.name}
                        aria-label="Table name"
                      />
                      <input
                        className="field narrow"
                        name="capacity"
                        type="number"
                        min={1}
                        max={100}
                        defaultValue={t.capacity}
                        aria-label="Seats"
                      />
                      <button className="ghost" type="submit">
                        Save
                      </button>
                    </div>
                  </form>
                  <form action={removeTable} style={{ marginTop: 8 }}>
                    <input type="hidden" name="event_id" value={id} />
                    <input type="hidden" name="table_id" value={t.id} />
                    <button className="ghost" type="submit">
                      Remove table
                    </button>
                  </form>
                  {t.households > 0 && (
                    <p className="t-sub" style={{ marginTop: 8 }}>
                      Removing it puts {t.households}{" "}
                      {t.households === 1 ? "household" : "households"} back on the
                      unseated list. Nobody leaves the guest list.
                    </p>
                  )}
                </details>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h2>Seat a household</h2>
        {unseated.data.length === 0 && plan.total_tables > 0 ? (
          <div className="empty">Everyone has a seat.</div>
        ) : unseated.data.length === 0 ? (
          <div className="empty">No households on this part of the event yet.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Household</th>
                <th>Party</th>
                <th>Table</th>
              </tr>
            </thead>
            <tbody>
              {unseated.data.map((h) => (
                <tr key={h.invitation_id}>
                  <td>
                    <div className="t-name">{h.display_name}</div>
                    <div className="t-sub">{h.category ?? "—"}</div>
                  </td>
                  <td>{h.allowance}</td>
                  <td>
                    <form action={seatHousehold} className="form-row">
                      <input type="hidden" name="event_id" value={id} />
                      <input type="hidden" name="leg_id" value={leg.id} />
                      <input
                        type="hidden"
                        name="invitation_id"
                        value={h.invitation_id}
                      />
                      <select
                        className="field"
                        name="table_id"
                        defaultValue=""
                        aria-label={`Table for ${h.display_name}`}
                      >
                        <option value="">No table</option>
                        {plan.tables.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {t.capacity - t.seats_used} free
                          </option>
                        ))}
                      </select>
                      <button className="ghost" type="submit">
                        Seat
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {plan.total_tables === 0 && (
          <p className="sub">Add some tables first and they&rsquo;ll appear here.</p>
        )}
      </div>
    </>
  );
}
