import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import {
  addGate,
  inviteUsher,
  removeGate,
  removeStaff,
  updateGate,
  updateStaff,
} from "./actions";

/**
 * Gates and the team, per the Team tab in
 * mockups/organiser-plans-reports-team.html.
 *
 * Until this page existed there was no way to put an usher on a gate, so
 * the scanner — the actual product — could not be used by a real customer.
 *
 * An usher is invited by phone because that is how they sign in: no
 * account needed beforehand, no password ever, and their assignment is
 * waiting when they request their first code.
 */

type Gate = {
  id: string;
  name: string;
  is_active: boolean;
  admitted: number;
  ushers: number;
};

type Staff = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string;
  role: string;
  entrance_id: string | null;
  entrance_name: string | null;
  can_walk_in: boolean;
  can_manual: boolean;
  can_override: boolean;
  last_tested_at: string | null;
  has_tested: boolean;
  scans: number;
};

const ERRORS: Record<string, string> = {
  bad_name: "A gate needs a name.",
  gate_exists: "There's already a gate with that name here.",
  gate_has_history:
    "People came through that gate, so it stays on the record. Close it instead — it disappears from the scanner either way.",
  bad_phone: "Use the full number with country code, like +234 803 411 2098.",
  wrong_leg_gate: "That gate belongs to a different part of the event.",
  cannot_grant_owner: "An event has one owner, and it isn't handed out here.",
  failed: "That didn't save — try again.",
};

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ leg?: string; error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();
  const leg = event.legs.find((l) => l.id === sp.leg) ?? event.legs[0];
  if (!leg) notFound();

  const [{ data: gates }, { data: staff }] = await Promise.all([
    api<Gate[]>(`/legs/${leg.id}/entrances`),
    api<Staff[]>(`/legs/${leg.id}/staff`),
  ]);

  const untested = staff.filter((s) => !s.has_tested).length;

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {event.name}
        </Link>
      </p>
      <h1 className="page">Gates &amp; team</h1>
      <p className="sub">
        Ushers only ever see the event and gate they&rsquo;re assigned to, and
        they can&rsquo;t export anyone&rsquo;s contact details.
      </p>

      {event.legs.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {event.legs.map((l) => (
            <Link
              key={l.id}
              className={l.id === leg.id ? "primary" : "ghost"}
              href={`/events/${id}/team?leg=${l.id}`}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}

      {sp.error && <p className="form-error">{ERRORS[sp.error] ?? ERRORS.failed}</p>}
      {sp.saved && !sp.error && <div className="plan-line">Saved.</div>}

      {staff.length > 0 && untested > 0 && (
        <div className="unassigned">
          <div>
            <div className="t">
              {untested} of {staff.length}{" "}
              {untested === 1 ? "usher hasn't" : "ushers haven't"} opened the
              scanner yet
            </div>
            <div className="s">
              Ask them to sign in and scan anything once before the day. A phone
              that has never opened the app is the most common thing that goes
              wrong at a gate.
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ gates */}
      <div className="card">
        <h2>Gates</h2>
        {gates.length === 0 ? (
          <div className="empty">
            No gates yet. Add at least one — an usher is assigned to a gate, and
            the report tells you which door people came through.
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Ushers</th>
                <th>Admitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {gates.map((g) => (
                <tr key={g.id}>
                  <td>
                    <div className="t-name">{g.name}</div>
                    {!g.is_active && <div className="t-sub">Closed</div>}
                  </td>
                  <td>{g.ushers}</td>
                  <td>{g.admitted}</td>
                  <td>
                    <details className="tedit">
                      <summary>Edit</summary>
                      <form action={updateGate} style={{ marginTop: 10 }}>
                        <input type="hidden" name="event_id" value={id} />
                        <input type="hidden" name="leg_id" value={leg.id} />
                        <input type="hidden" name="entrance_id" value={g.id} />
                        <div className="form-row">
                          <input
                            className="field"
                            name="name"
                            defaultValue={g.name}
                            aria-label="Gate name"
                          />
                          <label className="switch" title="Open">
                            <input
                              type="checkbox"
                              name="is_active"
                              defaultChecked={g.is_active}
                            />
                            <span />
                          </label>
                          <button className="ghost" type="submit">
                            Save
                          </button>
                        </div>
                      </form>
                      <form action={removeGate} style={{ marginTop: 8 }}>
                        <input type="hidden" name="event_id" value={id} />
                        <input type="hidden" name="leg_id" value={leg.id} />
                        <input type="hidden" name="entrance_id" value={g.id} />
                        <button className="ghost" type="submit">
                          Remove gate
                        </button>
                      </form>
                      {g.admitted > 0 && (
                        <p className="t-sub" style={{ marginTop: 8 }}>
                          People came through here, so it can only be closed,
                          not removed — the report has to keep naming it.
                        </p>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={addGate} style={{ marginTop: 16 }}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="leg_id" value={leg.id} />
          <div className="form-row">
            <input className="field" name="name" placeholder="Main Gate" required />
            <button className="primary" type="submit">
              Add gate
            </button>
          </div>
        </form>
      </div>

      {/* ------------------------------------------------------------- team */}
      <div className="card">
        <h2>Who&rsquo;s working</h2>
        {staff.length === 0 ? (
          <div className="empty">
            Nobody yet. Add an usher by phone number below — they don&rsquo;t
            need an account first.
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Person</th>
                <th>Gate</th>
                <th>Ready</th>
                <th>Can</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="t-name">{s.full_name || "Not named yet"}</div>
                    <div className="t-sub">
                      {s.phone}
                      {s.role !== "usher" ? ` · ${s.role.replace("_", " ")}` : ""}
                    </div>
                  </td>
                  <td>{s.entrance_name ?? "Any gate"}</td>
                  <td>
                    <span className={`badge ${s.has_tested ? "attending" : "not_sent"}`}>
                      {s.has_tested
                        ? s.scans > 0
                          ? `${s.scans} scans`
                          : "Tested"
                        : "Not opened"}
                    </span>
                  </td>
                  <td className="t-sub">
                    {[
                      s.can_manual ? "search by name" : null,
                      s.can_walk_in ? "add walk-ins" : null,
                      s.can_override ? "override RSVP" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "scan only"}
                  </td>
                  <td>
                    <details className="tedit">
                      <summary>Edit</summary>
                      <form action={updateStaff} style={{ marginTop: 10 }}>
                        <input type="hidden" name="event_id" value={id} />
                        <input type="hidden" name="leg_id" value={leg.id} />
                        <input type="hidden" name="assignment_id" value={s.id} />
                        <div className="form-row">
                          <select
                            className="field"
                            name="entrance_id"
                            defaultValue={s.entrance_id ?? ""}
                            aria-label="Gate"
                          >
                            <option value="">Any gate</option>
                            {gates.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                          <button className="ghost" type="submit">
                            Save
                          </button>
                        </div>
                        <div className="setrow" style={{ borderBottom: 0 }}>
                          <div className="setmain">
                            <div className="setlabel">Add walk-ins</div>
                            <div className="setdetail">
                              Let them put someone on the list at the door.
                            </div>
                          </div>
                          <label className="switch">
                            <input
                              type="checkbox"
                              name="can_walk_in"
                              defaultChecked={s.can_walk_in}
                            />
                            <span />
                          </label>
                        </div>
                        <div className="setrow" style={{ borderBottom: 0 }}>
                          <div className="setmain">
                            <div className="setlabel">Override an RSVP block</div>
                            <div className="setdetail">
                              Off by default. With it off, a blocked guest
                              fetches a manager instead.
                            </div>
                          </div>
                          <label className="switch">
                            <input
                              type="checkbox"
                              name="can_override"
                              defaultChecked={s.can_override}
                            />
                            <span />
                          </label>
                        </div>
                      </form>
                      <form action={removeStaff} style={{ marginTop: 8 }}>
                        <input type="hidden" name="event_id" value={id} />
                        <input type="hidden" name="leg_id" value={leg.id} />
                        <input type="hidden" name="assignment_id" value={s.id} />
                        <button className="ghost" type="submit">
                          Remove from this event
                        </button>
                      </form>
                      {s.scans > 0 && (
                        <p className="t-sub" style={{ marginTop: 8 }}>
                          Their {s.scans} {s.scans === 1 ? "scan" : "scans"} stay
                          in the report — removing them takes away access, not
                          history.
                        </p>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={inviteUsher} style={{ marginTop: 16 }}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="leg_id" value={leg.id} />
          <div className="form-row">
            <input
              className="field"
              name="full_name"
              placeholder="Musa"
              aria-label="Their name"
            />
            <input
              className="field"
              name="phone"
              placeholder="+234 803 411 2098"
              required
              aria-label="Their phone number"
            />
            <select className="field" name="entrance_id" aria-label="Gate">
              <option value="">Any gate</option>
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select className="field" name="role" aria-label="Role">
              <option value="usher">Usher</option>
              <option value="event_manager">Event manager</option>
            </select>
            <button className="primary" type="submit">
              Add
            </button>
          </div>
        </form>
        <p className="sub">
          They sign in with that number — we text them a code, no password and
          no app store account. Nothing is sent automatically yet, so tell them
          to open the scanner and sign in.
        </p>
      </div>

      {/* --------------------------------------------------- what each role does */}
      <div className="card">
        <h2>What each role can do</h2>
        <table className="list">
          <thead>
            <tr>
              <th>&nbsp;</th>
              <th>Owner</th>
              <th>Event manager</th>
              <th>Usher</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["See the guest list", "✓", "✓", "Own gate only"],
              ["Add and edit households", "✓", "✓", "—"],
              ["Send invitations", "✓", "✓", "—"],
              ["Assign tables", "✓", "✓", "—"],
              ["Check guests in", "✓", "✓", "✓"],
              ["See reports", "✓", "✓", "Own gate only"],
              ["Export the guest list", "✓", "✓", "—"],
              ["Billing and plans", "✓", "✓", "—"],
              ["Manage gates and team", "✓", "✓", "—"],
              ["Delete the event", "✓", "✓", "—"],
            ].map(([what, owner, manager, usher]) => (
              <tr key={what}>
                <td className="t-name">{what}</td>
                <td>{owner}</td>
                <td>{manager}</td>
                <td>{usher}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub">
          An usher&rsquo;s phone never downloads a guest&rsquo;s phone number —
          only the last four digits, so they can confirm one read aloud to them.
        </p>
      </div>
    </>
  );
}
