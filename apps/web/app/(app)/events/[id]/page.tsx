import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type Attendance, type EventShape } from "@/lib/org-api";

/**
 * The event dashboard — a countdown, not a report (design decision:
 * "18 days to go" is the largest element; no readiness percentage,
 * per spec/event-readiness-rules.md).
 */
export default async function EventHome({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  const leg = event.legs[0];
  const { data: att } = await api<Attendance>(`/legs/${leg.id}/attendance`);

  const now = Date.now();
  const start = new Date(leg.starts_at).getTime();
  const days = Math.ceil((start - now) / 86_400_000);
  const countdown =
    days > 1
      ? `${days} days to go`
      : days === 1
        ? "Tomorrow"
        : days === 0
          ? "It's today"
          : "Done";

  const fmt = new Intl.DateTimeFormat("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });

  return (
    <>
      <p className="eyebrow">{event.event_type}</p>
      <h1 className="page">{event.name}</h1>

      <div className="count-hero">
        <div className="big">{countdown}</div>
        <div className="when">
          {fmt.format(new Date(leg.starts_at))}
          {leg.venue_name ? ` · ${leg.venue_name}` : ""}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="n">{att.invitations}</div>
          <div className="l">Households</div>
        </div>
        <div className="stat">
          <div className="n">{att.invited_people}</div>
          <div className="l">People invited</div>
        </div>
        <div className="stat">
          <div className="n">{att.confirmed_people}</div>
          <div className="l">Confirmed — the caterer&rsquo;s number</div>
        </div>
        <div className="stat live">
          <div className="n">{att.arrived_people}</div>
          <div className="l">Arrived{att.refused > 0 ? ` · ${att.refused} refused` : ""}</div>
        </div>
      </div>

      <div className="plan-line">
        <b>{event.plan[0]?.toUpperCase() + event.plan.slice(1)} plan</b> — up to{" "}
        {event.people_limit} people. Building your list is free; the limit
        applies when invitations are sent.{" "}
        <Link href={`/events/${id}/billing`} style={{ color: "var(--p600)" }}>
          Plans &amp; billing
        </Link>
      </div>

      <div className="card">
        <h2>Guest list</h2>
        <p className="sub" style={{ marginTop: 0, marginBottom: 14 }}>
          {att.invitations === 0
            ? "Start with your guest list — one row per household, exactly as it would be written on a card."
            : `${att.invitations} households · ${att.invited_people} people.`}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="primary" href={`/events/${id}/guests`}>
            {att.invitations === 0 ? "Build the list" : "Open the guest list"}
          </Link>
          <Link className="ghost" href={`/events/${id}/live`}>
            Live check-in
          </Link>
          <Link className="ghost" href={`/events/${id}/tables`}>
            Tables
          </Link>
          {att.arrived_people > 0 && (
            <Link className="ghost" href={`/events/${id}/report`}>
              See the report
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
