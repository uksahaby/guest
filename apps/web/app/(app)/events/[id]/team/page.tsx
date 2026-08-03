import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import {
  addGate,
  addTeam,
  inviteUsher,
  makeInviteLink,
  reportIncident,
  resolveIncident,
} from "./actions";

/**
 * Gates & Teams.
 *
 * Two tabs: the entry points, and the people on them. Counts come from
 * check_in_events and membership from staff_assignments — nothing here is
 * a stored total.
 *
 * "Active now" is evidence, not a roster. It counts people whose scanner
 * has actually been used today, because a list of who was asked to come is
 * not a list of who came, and at 4pm the difference is the whole question.
 */

type Gate = {
  id: string;
  name: string;
  location: string | null;
  is_active: boolean;
  admitted: number;
  last_seen_at: string | null;
  staff: number;
  team_name: string | null;
  team_members: number;
};

type Team = {
  id: string;
  name: string;
  description: string | null;
  role: string;
  is_active: boolean;
  entrance_id: string | null;
  entrance_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  members: number;
  on_duty: number;
};

type Staff = {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  entrance_id: string | null;
  entrance_name: string | null;
  team_id: string | null;
  team_name: string | null;
  last_tested_at: string | null;
  last_scan_at: string | null;
};

type Incident = {
  id: string;
  kind: string;
  note: string;
  created_at: string;
  resolved_at: string | null;
  entrance_name: string | null;
  reported_by: string | null;
};

type Payload = {
  gates: Gate[];
  teams: Team[];
  staff: Staff[];
  incidents: Incident[];
  totals: {
    gates: number;
    gates_active: number;
    members: number;
    on_duty: number;
    today: number;
    open_incidents: number;
    all_incidents: number;
  };
};

const ROLE: Record<string, string> = {
  gate_staff: "Gate Staff",
  support: "Support Staff",
  security: "Security",
};

function initial(name: string | null): string {
  const w = (name ?? "?").trim().split(/\s+/).filter((x) => /[A-Za-zÀ-ɏ]/.test(x));
  return (w[w.length - 1] ?? "?").slice(0, 1).toUpperCase();
}

function ago(iso: string | null): string {
  if (!iso) return "no activity yet";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** Live is evidence: a scan in the last quarter of an hour. */
const live = (iso: string | null) =>
  !!iso && Date.now() - new Date(iso).getTime() < 15 * 60_000;

export default async function GatesTeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    invite?: string;
    error?: string;
    added?: string;
    resolved?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();
  const leg = event.legs[0];

  const { status: gst, data } = await api<Payload>(`/events/${id}/gates`);
  if (gst !== 200) notFound();

  const t = data.totals;
  const here = `/events/${id}/team`;
  const tab = sp.tab === "teams" ? "teams" : "gates";
  const totalAdmitted = data.gates.reduce((n, g) => n + g.admitted, 0);

  const fmtT = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos",
  });

  const cards = [
    { label: "Total Gates", n: t.gates,
      foot: `${t.gates_active} Active · ${t.gates - t.gates_active} Inactive`,
      tone: "", d: "M4 20V8l8-4 8 4v12M9 20v-6h6v6" },
    { label: "Team Members", n: t.members,
      foot: `${data.teams.length} team${data.teams.length === 1 ? "" : "s"}`,
      tone: "mute",
      d: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-1a4 4 0 0 0-3-3.9" },
    { label: "Active Now", n: t.on_duty, foot: "scanned today", tone: "ok",
      d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 8v4l3 2" },
    { label: "Checked In Today", n: t.today, foot: "across all gates", tone: "ok",
      d: "M20 6 9 17l-5-5" },
    { label: "Incidents", n: t.all_incidents,
      foot: t.open_incidents > 0 ? `${t.open_incidents} open` : "all resolved",
      tone: t.open_incidents > 0 ? "warn" : "mute",
      d: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" },
  ];

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My Events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>Gates &amp; Teams</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">Gates &amp; Teams</h1>
          <p className="sub">
            Manage entry points (gates) and your event team assignments.
          </p>
        </div>
        <div className="head-actions">
          <a className="ghost" href="#roles">View Access Roles</a>
          <a className="primary" href="#add">+ Add Gate or Team</a>
        </div>
      </div>

      {sp.added && (
        <div className="plan-line">
          <b>
            {sp.added === "team" ? "Team added." : "Incident recorded."}
          </b>
        </div>
      )}
      {sp.resolved && <div className="plan-line"><b>Marked resolved.</b></div>}
      {sp.error && (
        <p className="form-error">
          {sp.error === "team_exists"
            ? "A team with that name already exists."
            : sp.error === "missing"
              ? "Fill the name in first."
              : "That didn't work — try again."}
        </p>
      )}
      {sp.invite && <InviteLink url={sp.invite} />}

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
      </div>

      <div className="grid-side">
        <div>
          <div className="card">
            <div className="tabs">
              <Link className={tab === "gates" ? "on" : ""} href={here}>
                Gates Management
              </Link>
              <Link className={tab === "teams" ? "on" : ""} href={`${here}?tab=teams`}>
                Teams Management
              </Link>
            </div>

            {tab === "gates" ? (
              <>
                <div className="card-title">
                  <span>
                    <b>Event Entry Gates</b>
                    <small className="sub"> Manage all entry points for your event.</small>
                  </span>
                  <a className="ghost sm" href="#add-gate">+ Add New Gate</a>
                </div>

                <div className="table-wrap">
                  <table className="list guests">
                    <thead>
                      <tr>
                        <th>Gate Name</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th>Assigned Team</th>
                        <th>Checked In</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.gates.map((g) => (
                        <tr key={g.id}>
                          <td>
                            <div className="who">
                              <span className="gate-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                  strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6" />
                                </svg>
                              </span>
                              <div>
                                <b>{g.name}</b>
                                <small>{g.staff} on this gate</small>
                              </div>
                            </div>
                          </td>
                          <td>{g.location ?? <span className="none">—</span>}</td>
                          <td>
                            <span className={`badge ${g.is_active ? "attending" : "d-not_sent"}`}>
                              {g.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td>
                            {g.team_name ? (
                              <div className="who">
                                <span className="avatar sm" aria-hidden="true">
                                  {initial(g.team_name)}
                                </span>
                                <div>
                                  <b>{g.team_name}</b>
                                  <small>{g.team_members} members</small>
                                </div>
                              </div>
                            ) : (
                              <span className="none">—</span>
                            )}
                          </td>
                          <td>
                            {g.is_active ? (
                              <>
                                <b>{g.admitted.toLocaleString("en-NG")}</b>
                                <small className="stack">
                                  {totalAdmitted > 0
                                    ? `${((g.admitted / totalAdmitted) * 100).toFixed(1)}%`
                                    : "0.0%"}
                                </small>
                              </>
                            ) : (
                              <span className="none">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="perf-strip">
                  <span className="stat-icon ok" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 20V10m7 10V4m7 16v-7" />
                    </svg>
                  </span>
                  <div>
                    <strong>Gate Performance Overview</strong>
                    <small>Track real-time check-ins across all gates.</small>
                  </div>
                  <Link className="ghost sm" href={`/events/${id}/live`}>
                    View Analytics
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="card-title">
                  <span>
                    <b>Teams Overview</b>
                    <small className="sub"> Manage your event teams and their assignments.</small>
                  </span>
                  <a className="ghost sm" href="#add-team">+ Add Team</a>
                </div>

                {data.teams.length === 0 ? (
                  <p className="sub">
                    No teams yet. A single-gate wedding does not need them —
                    ushers work without one.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table className="list guests">
                      <thead>
                        <tr>
                          <th>Team Name</th>
                          <th>Team Lead</th>
                          <th>Members</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>On Duty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.teams.map((tm) => (
                          <tr key={tm.id}>
                            <td>
                              <div className="who">
                                <span className="gate-icon" aria-hidden="true">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
                                  </svg>
                                </span>
                                <div>
                                  <b>{tm.name}</b>
                                  <small>{tm.description ?? tm.entrance_name ?? "—"}</small>
                                </div>
                              </div>
                            </td>
                            <td>
                              {tm.lead_name ? (
                                <div className="who">
                                  <span className="avatar sm" aria-hidden="true">
                                    {initial(tm.lead_name)}
                                  </span>
                                  <div>
                                    <b>{tm.lead_name}</b>
                                    <small>{tm.lead_email ?? tm.lead_phone}</small>
                                  </div>
                                </div>
                              ) : (
                                <span className="none">No lead</span>
                              )}
                            </td>
                            <td className="num">{tm.members}</td>
                            <td>
                              <span className={`chip type-${tm.role}`}>
                                {ROLE[tm.role] ?? tm.role}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${tm.is_active ? "attending" : "d-not_sent"}`}>
                                {tm.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="num">{tm.on_duty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="foot">
                  Showing {data.teams.length} of {data.teams.length} teams
                </p>
              </>
            )}
          </div>

          {/* ------------------------------------------- the roster */}
          <div className="card" id="roles">
            <h2 className="card-title">
              Who is on a gate
              <span className="muted-count">{data.staff.length} people</span>
            </h2>
            {data.staff.length === 0 ? (
              <p className="sub">Nobody yet. Add someone below.</p>
            ) : (
              <div className="table-wrap">
                <table className="list guests">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Gate</th>
                      <th>Team</th>
                      <th>Ready</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.staff.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="who">
                            <span className="avatar" aria-hidden="true">
                              {initial(s.full_name)}
                            </span>
                            <div>
                              <b>{s.full_name ?? "Unnamed"}</b>
                              <small>{s.email ?? s.phone}</small>
                            </div>
                          </div>
                        </td>
                        <td>{s.entrance_name ?? <span className="none">Any gate</span>}</td>
                        <td>{s.team_name ?? <span className="none">—</span>}</td>
                        <td>
                          {s.last_tested_at || s.last_scan_at ? (
                            <span className="badge attending">Tested</span>
                          ) : (
                            <span className="badge pending">Never opened</span>
                          )}
                        </td>
                        <td className="right">
                          <form action={makeInviteLink}>
                            <input type="hidden" name="event_id" value={id} />
                            <input type="hidden" name="leg_id" value={leg?.id ?? ""} />
                            <input type="hidden" name="staff_id" value={s.id} />
                            <button className="ghost sm" type="submit">
                              Get sign-in link
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ------------------------------------------------ add */}
          <div className="grid-2" id="add">
            <div className="card" id="add-gate">
              <h2 className="card-title">Add a gate</h2>
              <form action={addGate}>
                <input type="hidden" name="event_id" value={id} />
                <input type="hidden" name="leg_id" value={leg?.id ?? ""} />
                <div className="form-row">
                  <input className="field" name="name" placeholder="Main Gate"
                    required aria-label="Gate name" />
                  <button className="primary" type="submit">Add</button>
                </div>
              </form>

              <h2 className="card-title" style={{ marginTop: 18 }} id="add-team">
                Add a team
              </h2>
              <form action={addTeam}>
                <input type="hidden" name="event_id" value={id} />
                <div className="form-row">
                  <input className="field" name="name" placeholder="Team Alpha"
                    required aria-label="Team name" />
                  <input className="field" name="description"
                    placeholder="Main Entrance Team" aria-label="Description" />
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <select className="field" name="role" aria-label="Role">
                    <option value="gate_staff">Gate Staff</option>
                    <option value="support">Support Staff</option>
                    <option value="security">Security</option>
                  </select>
                  <select className="field" name="entrance_id" aria-label="Gate">
                    <option value="">No gate yet</option>
                    {data.gates.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <button className="primary" type="submit">Add team</button>
                </div>
              </form>
            </div>

            <div className="card">
              <h2 className="card-title">Add someone to a gate</h2>
              <form action={inviteUsher}>
                <input type="hidden" name="event_id" value={id} />
                <input type="hidden" name="leg_id" value={leg?.id ?? ""} />
                <div className="form-row">
                  <input className="field" name="full_name" placeholder="Musa"
                    aria-label="Their name" />
                  <input className="field" name="phone" required
                    placeholder="+234 803 411 2098" aria-label="Their phone number" />
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <select className="field" name="entrance_id" aria-label="Gate">
                    <option value="">Any gate</option>
                    {data.gates.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <select className="field" name="role" aria-label="Role">
                    <option value="usher">Usher</option>
                    <option value="event_manager">Event manager</option>
                  </select>
                  <button className="primary" type="submit">Add</button>
                </div>
              </form>
              <p className="sub sm" style={{ marginTop: 10 }}>
                Adding them tells them nothing. Use <b>Get sign-in link</b> on
                their row and send it over WhatsApp — that link is how they
                sign in, on the scanner app or in their browser.
              </p>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------ right rail */}
        <aside className="rail">
          <section className="card">
            <h2 className="card-title">
              Live Gate Status
              <span className="live-dot">LIVE</span>
            </h2>
            <ul className="gate-list">
              {data.gates.map((g) => (
                <li key={g.id}>
                  <span className="gate-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6" />
                    </svg>
                  </span>
                  <div>
                    <strong>{g.name}</strong>
                    <small>{g.location ?? "No location set"}</small>
                  </div>
                  <div className="gate-right">
                    <b>{g.is_active ? g.admitted : "—"}</b>
                    <span className={`pill-live ${live(g.last_seen_at) ? "on" : ""}`}>
                      {!g.is_active ? "Closed" : live(g.last_seen_at) ? "Online" : "Idle"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <Link className="ghost wide" href={`/events/${id}/live`}>
              View All Gate Activity
            </Link>
          </section>

          <section className="card">
            <h2 className="card-title">Quick Actions</h2>
            <ul className="actions">
              <li>
                <a href="#add-gate">
                  <strong>Add New Gate</strong>
                  <small>Create a new entry point</small>
                </a>
              </li>
              <li>
                <a href="#add-team">
                  <strong>Add New Team</strong>
                  <small>Create a new team</small>
                </a>
              </li>
              <li>
                <a href="#roles">
                  <strong>Assign Team to Gate</strong>
                  <small>Manage gate assignments</small>
                </a>
              </li>
              <li>
                <Link href={`/events/${id}/live`}>
                  <strong>Gate activity</strong>
                  <small>What each gate is doing now</small>
                </Link>
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 className="card-title">
              Recent Incidents
              <span className="muted-count">
                {t.open_incidents > 0 ? `${t.open_incidents} open` : "all clear"}
              </span>
            </h2>

            {data.incidents.length === 0 ? (
              <p className="sub">
                Nothing recorded. A guest argument or a code that will not
                scan is worth noting — otherwise it lives on somebody&rsquo;s
                hand until it is forgotten.
              </p>
            ) : (
              <ul className="incidents">
                {data.incidents.slice(0, 5).map((i) => (
                  <li key={i.id}>
                    <span className={`inc-dot ${i.resolved_at ? "done" : "open"}`}
                      aria-hidden="true" />
                    <div>
                      <strong>{i.note}</strong>
                      <small>
                        {i.entrance_name ? `${i.entrance_name} · ` : ""}
                        {fmtT.format(new Date(i.created_at))}
                        {i.resolved_at ? " · Resolved" : ""}
                      </small>
                    </div>
                    {!i.resolved_at && (
                      <form action={resolveIncident}>
                        <input type="hidden" name="event_id" value={id} />
                        <input type="hidden" name="incident_id" value={i.id} />
                        <button className="ghost sm" type="submit">Resolve</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form action={reportIncident} style={{ marginTop: 12 }}>
              <input type="hidden" name="event_id" value={id} />
              <div className="form-row">
                <input className="field" name="note" required
                  placeholder="What happened?" aria-label="What happened" />
                <select className="field" name="entrance_id" aria-label="Gate">
                  <option value="">No gate</option>
                  {data.gates.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button className="ghost" type="submit">Record</button>
              </div>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}

/**
 * The one-time sign-in link, shown once.
 *
 * A POST behind a button rather than a plain link: WhatsApp fetches URLs
 * to build previews, and a single-use link consumed on GET would be spent
 * by the preview bot before the usher ever tapped it.
 */
function InviteLink({ url }: { url: string }) {
  const message =
    `You're on the gate for this event. Tap to start checking guests in: ${url}`;
  return (
    <div className="card invite-ready">
      <b>Sign-in link ready — send it now</b>
      <p className="sub">
        It works once, expires in 14 days, and is the only copy. They can tap
        it to scan in their browser, or paste the whole message into the
        scanner app — whichever they open first spends it.
      </p>
      <code>{url}</code>
      <a className="ghost" target="_blank" rel="noreferrer"
        href={`https://wa.me/?text=${encodeURIComponent(message)}`}>
        Send on WhatsApp
      </a>
    </div>
  );
}
