import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/org-api";

/**
 * The morning after, per mockups/organiser-plans-reports-team.html:
 * five tiles, the arrival histogram with a sentence saying what it means,
 * a by-gate table, and every refusal.
 *
 * The histogram is CSS bars — a chart library would be several hundred
 * kilobytes to draw fifteen rectangles.
 */

type Refusal = {
  id: string;
  result: string;
  recorded_at: string;
  display_name: string;
  entrance_name: string | null;
  staff_name: string | null;
};

type LegReport = {
  leg_id: string;
  leg_name: string;
  starts_at: string;
  venue_name: string | null;
  closed_at: string | null;
  invitations: number;
  invited_people: number;
  confirmed_people: number;
  replied_invitations: number;
  arrived_people: number;
  no_shows: number;
  overflow_people: number;
  overflow_parties: number;
  refused: number;
  manual_check_ins: number;
  manual_households: number;
  arrivals_by_half_hour: { from: string; count: number }[];
  by_entrance: {
    entrance_id: string;
    name: string;
    admitted: number;
    refused: number;
    ushers: string | null;
    busiest_from: string | null;
  }[];
  refusals: Refusal[];
};

type Report = {
  event_id: string;
  event_name: string;
  legs: LegReport[];
};

const REFUSAL_WORDS: Record<string, string> = {
  invalid: "Invalid — the code didn't verify",
  wrong_event: "Wrong event — the pass belongs to another wedding",
  wrong_leg: "Not invited to this part of the event",
  revoked: "Revoked — removed from the guest list",
  allowance_exhausted: "Party full — everyone invited was already in",
  rsvp_blocked: "No reply on file, and this event required one",
  rsvp_declined: "They had replied no",
  overflow_blocked: "More people than the invitation allowed",
  not_found: "No matching guest on the list",
};

function timeOf(iso: string) {
  // 12-hour, as the mockup's "5:45–6:15 PM" — and as anyone in Lagos
  // would say it.
  return new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

function halfHourLabel(iso: string) {
  const end = new Date(new Date(iso).getTime() + 30 * 60_000).toISOString();
  return `${timeOf(iso)}–${timeOf(end)}`;
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { status, data: report } = await api<Report>(`/events/${id}/report`);
  if (status !== 200) notFound();

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {report.event_name}
        </Link>
      </p>
      <h1 className="page">Report</h1>

      {report.legs.map((leg) => (
        <Leg key={leg.leg_id} leg={leg} eventId={id} />
      ))}
    </>
  );
}

function Leg({ leg, eventId }: { leg: LegReport; eventId: string }) {
  const dateLabel = new Intl.DateTimeFormat("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Lagos",
  }).format(new Date(leg.starts_at));

  const busiest = [...leg.arrivals_by_half_hour].sort((a, b) => b.count - a.count)[0];
  const peak = leg.arrivals_by_half_hour.reduce((m, b) => Math.max(m, b.count), 0);
  const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100));

  return (
    <>
      <p className="sub">
        {leg.leg_name} · {dateLabel}
        {leg.venue_name ? ` · ${leg.venue_name}` : ""}
        {leg.closed_at ? ` · last scan ${timeOf(leg.closed_at)}` : " · no scans yet"}
      </p>
      <div style={{ marginTop: 14 }}>
        <a className="primary" href={`/events/${eventId}/report/export`}>
          Export CSV
        </a>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="n">{leg.invited_people}</div>
          <div className="l">Invited · {leg.invitations} invitations</div>
        </div>
        <div className="stat">
          <div className="n">{leg.confirmed_people}</div>
          <div className="l">
            Confirmed · {pct(leg.replied_invitations, leg.invitations)}% replied
          </div>
        </div>
        <div className="stat live">
          <div className="n">{leg.arrived_people}</div>
          <div className="l">
            Arrived · {pct(leg.arrived_people, leg.invited_people)}% of invited
          </div>
        </div>
        <div className="stat">
          <div className="n">{leg.no_shows}</div>
          <div className="l">No-shows · confirmed, didn&rsquo;t come</div>
        </div>
        <div className="stat">
          <div className="n">{leg.overflow_people}</div>
          <div className="l">
            Over allowance · across {leg.overflow_parties}{" "}
            {leg.overflow_parties === 1 ? "party" : "parties"}
          </div>
        </div>
      </div>

      {leg.arrivals_by_half_hour.length > 0 && (
        <div className="card">
          <h2>When people arrived</h2>
          <p className="t-sub" style={{ marginBottom: 18 }}>
            Guests admitted, in 30-minute blocks
          </p>
          <div className="histo">
            {leg.arrivals_by_half_hour.map((b) => (
              <div className="hbar" key={b.from}>
                <div className="hcount">{b.count}</div>
                <div
                  className="hfill"
                  style={{ height: `${Math.max(4, (b.count / peak) * 100)}%` }}
                />
                <div className="hlabel">{timeOf(b.from)}</div>
              </div>
            ))}
          </div>
          {busiest && (
            <p className="sub">
              <b>{busiest.count} people</b> arrived between{" "}
              {halfHourLabel(busiest.from)} — {pct(busiest.count, leg.arrived_people)}% of
              the night through {leg.by_entrance.length}{" "}
              {leg.by_entrance.length === 1 ? "gate" : "gates"} in half an hour.
            </p>
          )}
        </div>
      )}

      {leg.by_entrance.length > 0 && (
        <div className="card">
          <h2>By gate</h2>
          <table className="list">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Ushers</th>
                <th>Admitted</th>
                <th>Refused</th>
                <th>Busiest</th>
              </tr>
            </thead>
            <tbody>
              {leg.by_entrance.map((e) => (
                <tr key={e.entrance_id}>
                  <td className="t-name">{e.name}</td>
                  <td>{e.ushers ?? "—"}</td>
                  <td>{e.admitted}</td>
                  <td>{e.refused}</td>
                  <td>{e.busiest_from ? halfHourLabel(e.busiest_from) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Refused at the gate</h2>
        {leg.refusals.length === 0 ? (
          <div className="empty">Nobody was turned away.</div>
        ) : (
          <>
            <table className="list">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>What happened</th>
                  <th>Gate</th>
                  <th>Usher</th>
                </tr>
              </thead>
              <tbody>
                {leg.refusals.map((r) => (
                  <tr key={r.id}>
                    <td>{timeOf(r.recorded_at)}</td>
                    <td>
                      <div className="t-name">{REFUSAL_WORDS[r.result] ?? r.result}</div>
                      {r.display_name !== "—" && (
                        <div className="t-sub">{r.display_name}</div>
                      )}
                    </td>
                    <td>{r.entrance_name ?? "—"}</td>
                    <td>{r.staff_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sub">
              Every scan is recorded, including the ones that were turned away.
            </p>
          </>
        )}
      </div>

      {leg.manual_check_ins > 0 && (
        <div className="card">
          <h2>Checked in by hand</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            {leg.manual_check_ins}{" "}
            {leg.manual_check_ins === 1 ? "guest was" : "guests were"} admitted by
            name search across {leg.manual_households}{" "}
            {leg.manual_households === 1 ? "household" : "households"}{" "}
            — usually a dead phone. It&rsquo;s flagged because it&rsquo;s the one action that
            bypasses the pass entirely.
          </p>
        </div>
      )}
    </>
  );
}
