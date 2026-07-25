import Link from "next/link";
import { api, type EventShape } from "@/lib/org-api";
import { createEvent } from "./actions";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const { data: events } = await api<EventShape[]>("/events");

  const fmt = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });

  return (
    <>
      <p className="eyebrow">Your events</p>
      <h1 className="page">
        {events.length === 0 ? "Let's set up your first event" : "Events"}
      </h1>

      {sp.error && (
        <p className="form-error">
          {sp.error === "missing"
            ? "The event needs a name and a date."
            : "That didn't save — try again."}
        </p>
      )}

      {events.length > 0 && (
        <div className="card">
          <table className="list">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Venue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="t-name">{e.name}</td>
                  <td>{e.legs[0] ? fmt.format(new Date(e.legs[0].starts_at)) : "—"}</td>
                  <td>{e.legs[0]?.venue_name ?? "—"}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="ghost" href={`/events/${e.id}`}>
                        Open
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>New event</h2>
        <form action={createEvent}>
          <div className="form-row">
            <input
              className="field"
              name="name"
              placeholder="Ahmed & Aisha"
              required
            />
            <input
              className="field"
              name="starts_at"
              type="datetime-local"
              required
            />
            <input className="field" name="venue" placeholder="Venue (optional)" />
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="primary" type="submit">
              Create event
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
