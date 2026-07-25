import Link from "next/link";
import { notFound } from "next/navigation";
import {
  api,
  type EventShape,
  type InvitationRow,
} from "@/lib/org-api";
import { addHousehold } from "../../actions";

/**
 * The guest list — one row per household ("Mr & Mrs Adeyemi, admits 4"),
 * per mockups/event-workspace.html. Party arrival shows as pips ●●●○ —
 * scannable across 186 rows without reading a number.
 */
export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; q?: string; imported?: string; skipped?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();
  const leg = event.legs[0];

  const q = (sp.q ?? "").trim();
  const { data: list } = await api<{ data: InvitationRow[] }>(
    `/events/${id}/invitations${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {event.name}
        </Link>
      </p>
      <h1 className="page">Guests</h1>

      {sp.imported && (
        <div className="plan-line">
          <b>Imported {sp.imported} {sp.imported === "1" ? "household" : "households"}.</b>
          {sp.skipped && sp.skipped !== "0"
            ? ` ${sp.skipped} were already on the list and were left alone.`
            : ""}
        </div>
      )}

      {sp.error && (
        <p className="form-error">
          {sp.error === "name"
            ? "The household needs a name."
            : "That didn't save — try again."}
        </p>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ marginBottom: 0 }}>Add a household</h2>
          <Link className="ghost" href={`/events/${id}/guests/import`}>
            Import a spreadsheet
          </Link>
        </div>
        <form action={addHousehold}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="leg_id" value={leg.id} />
          <div className="form-row">
            <input
              className="field"
              name="display_name"
              placeholder="Mr & Mrs Adeyemi"
              required
            />
            <input className="field" name="phone" placeholder="+234 803 411 2098" />
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
      </div>

      <div className="card">
        <form method="GET" style={{ marginBottom: 14 }}>
          <input
            className="field"
            name="q"
            placeholder="Search name or phone…"
            defaultValue={q}
          />
        </form>

        {list.data.length === 0 ? (
          <div className="empty">
            {q
              ? "Nothing matches that search."
              : "No households yet. The list is always free to build."}
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Household</th>
                <th>Party</th>
                <th>Reply</th>
                <th>Arrived</th>
                <th>Invite</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((inv) => {
                const l = inv.legs[0];
                return (
                  <tr key={inv.id}>
                    <td>
                      <div className="t-name">{inv.display_name}</div>
                      <div className="t-sub">
                        {[inv.category, inv.primary_phone]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </td>
                    <td>{l?.allowance ?? "—"}</td>
                    <td>
                      <span className={`badge ${l?.rsvp ?? "pending"}`}>
                        {l?.rsvp === "partial"
                          ? `${l.rsvp_count} of ${l.allowance}`
                          : l?.rsvp === "attending"
                            ? "Attending"
                            : l?.rsvp === "declined"
                              ? "Declined"
                              : "No reply"}
                      </span>
                    </td>
                    <td>
                      {l && (
                        <span
                          className="pips"
                          title={`${l.admitted} of ${l.allowance} arrived`}
                        >
                          {"●".repeat(Math.min(l.admitted, l.allowance))}
                          {l.admitted > l.allowance ? `+${l.admitted - l.allowance}` : ""}
                          <span className="off">
                            {"○".repeat(Math.max(0, l.allowance - l.admitted))}
                          </span>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${inv.delivery_state}`}>
                        {inv.delivery_state === "opened"
                          ? "Opened"
                          : inv.delivery_state === "link_generated"
                            ? "Link made"
                            : inv.delivery_state === "sent"
                              ? "Sent"
                              : "Not sent"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="ghost"
                          href={`/events/${id}/guests/${inv.id}/link`}
                        >
                          WhatsApp
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
