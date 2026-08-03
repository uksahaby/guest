import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { api } from "@/lib/org-api";
import {
  cancelEvent,
  deleteEvent,
  reissuePasses,
  saveAccess,
  saveDetails,
  saveVenue,
  setPublished,
  updateEvent,
  uploadCover,
} from "./actions";
import { CoverUpload, DescriptionField, TagEditor } from "./details-client";
import { CopyLink } from "./copy-link";
import { TABS, TabIcon, type TabKey } from "./tabs";

/**
 * Event settings.
 *
 * Eleven tabs down the left, the settings themselves in the middle, and a
 * rail on the right that never changes — status, link, who can get in, and
 * the things you cannot undo. The rail stays put on every tab because
 * "is this event live?" is the question an organiser has while reading any
 * of them.
 *
 * Two rules carried over from the settings screen this replaces, both
 * load-bearing:
 *
 *   Every gate toggle says what it would cost RIGHT NOW — "Off. 81 people
 *   never replied and would be stopped at the gate if you turn this on."
 *   A switch with a number beside it is a decision; a switch on its own is
 *   a guess.
 *
 *   Gate policy saves per switch, not with the page. Save Changes batches
 *   the text on Event Details and Venue & Time, which is what the mockup
 *   shows; it does not batch a switch that decides who gets through the
 *   door, because that is how an event arrives at the gate refusing people
 *   nobody meant to refuse.
 */

type Leg = {
  id: string;
  name: string;
  starts_at: string;
  doors_close_at: string | null;
  venue_name: string | null;
  address_line: string | null;
  city: string | null;
  all_day: boolean;
};

type Settings = {
  id: string;
  name: string;
  event_type: string;
  description: string | null;
  status: string;
  allow_overflow: boolean;
  require_rsvp: boolean;
  allow_walkins: boolean;
  allow_usher_undo: boolean;
  rsvp_deadline: string | null;
  manager_phone: string | null;
  token_version: number;
  end_date: string | null;
  timezone: string;
  tags: string[];
  slug: string | null;
  public_page: boolean;
  invitation_only: boolean;
  event_types: string[];
  legs: Leg[];
  consequences: {
    active_passes: number;
    never_replied_households: number;
    never_replied_people: number;
    overflow_parties: number;
    overflow_people: number;
    walk_ins: number;
    scans_recorded: number;
    invitations_sent: number;
  };
};

/** The zones an organiser here actually picks between. */
const ZONES: { id: string; label: string }[] = [
  { id: "Africa/Lagos", label: "(GMT+1) West Africa Time" },
  { id: "Africa/Accra", label: "(GMT+0) Ghana Mean Time" },
  { id: "Africa/Nairobi", label: "(GMT+3) East Africa Time" },
  { id: "Africa/Johannesburg", label: "(GMT+2) South Africa Standard Time" },
  { id: "Europe/London", label: "(GMT+0/+1) United Kingdom" },
  { id: "America/New_York", label: "(GMT-5/-4) US Eastern" },
  { id: "UTC", label: "(GMT+0) Coordinated Universal Time" },
];

function partsIn(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { get };
}

/** "YYYY-MM-DD" for a date input, read in the event's own zone. */
function dateIn(iso: string, tz: string): string {
  const { get } = partsIn(iso, tz);
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "HH:mm" for a time input, likewise. */
function timeIn(iso: string, tz: string): string {
  const { get } = partsIn(iso, tz);
  // Midnight comes back as 24 in some locales' 24-hour formatting.
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${h}:${get("minute")}`;
}

function titleCase(s: string): string {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/** A toggle that saves itself, with the consequence written underneath. */
function Toggle({
  eventId, field, on, label, detail, tab,
}: {
  eventId: string;
  field: string;
  on: boolean;
  label: string;
  detail: string;
  tab: TabKey;
}) {
  return (
    <form action={updateEvent} className="setrow">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="tab" value={tab} />
      <div className="setmain">
        <div className="setlabel">{label}</div>
        <div className="setdetail">{detail}</div>
      </div>
      {/* The checkbox gets its own name and no hidden partner: an unchecked
          box simply isn't submitted, which is exactly the semantic we want.
          Pairing a hidden "off" field with a checkbox of the SAME name looks
          equivalent but isn't — FormData.get() returns the first value, so
          the hidden one always wins and the toggle silently never turns on. */}
      <label className="switch">
        <input type="checkbox" name="on" defaultChecked={on} />
        <span />
      </label>
      <button className="ghost" type="submit">Save</button>
    </form>
  );
}

function Check({ on }: { on: boolean }) {
  return on ? (
    <svg className="acc-yes" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="On">
      <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  ) : (
    <svg className="acc-no" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Off">
      <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: s } = await api<Settings>(`/events/${id}/settings`);
  if (status !== 200) notFound();

  const c = s.consequences;
  const leg = s.legs[0];
  const tz = s.timezone || "Africa/Lagos";
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "details") as TabKey;
  const current = TABS.find((t) => t.key === tab)!;
  const published = s.status === "active";

  // The link an organiser sends. Built from the host actually serving this
  // page so it is right on localhost, on staging and in production without
  // a fourth environment variable to forget.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const publicUrl = s.slug ? `${origin}/e/${s.slug}` : null;

  /** Batched tabs post one form; the header button drives it by id. */
  const batched = tab === "details" || tab === "venue";

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page">Event Settings</h1>
          <p className="sub" style={{ marginTop: 2 }}>
            Manage and customize your event preferences and configuration.
          </p>
        </div>
        <div className="head-actions">
          {publicUrl && s.public_page ? (
            <a className="ghost with-icon" href={publicUrl} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview Event Page
            </a>
          ) : (
            // Disabled rather than hidden: the button is where the mockup
            // puts it, and the title says the one thing that would make it
            // work rather than leaving a dead link to find out with.
            <span
              className="ghost with-icon disabled"
              title={
                s.slug
                  ? "Turn on the public event page under Privacy & Visibility to preview it."
                  : "Give this event a link under Privacy & Visibility, then turn the public page on."
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview Event Page
            </span>
          )}
          {batched && (
            <button className="primary with-icon" type="submit" form="ev-settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6" />
              </svg>
              Save Changes
            </button>
          )}
        </div>
      </div>

      {sp.saved && <div className="flash ok">Saved.</div>}
      {sp.error && (
        <div className="flash bad">
          {sp.error === "slug_taken"
            ? "That link is already in use by another event. Try adding the year."
            : sp.error === "bad_slug"
              ? "A link can use lowercase letters, numbers and hyphens only."
              : "That didn’t save. If you were confirming something, the word has to match exactly."}
        </div>
      )}
      {s.status === "cancelled" && (
        <div className="flash bad">
          This event is cancelled. Guests see a notice and passes no longer open
          the gate. Everything is still here — publish it again to undo.
        </div>
      )}

      <div className="grid-settings">
        {/* ------------------------------------------------------- the tabs */}
        <nav className="card settabs" aria-label="Settings sections">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/events/${id}/settings?tab=${t.key}`}
              className={`settab${t.key === tab ? " on" : ""}`}
              aria-current={t.key === tab ? "page" : undefined}
            >
              <TabIcon name={t.icon} />
              {t.label}
            </Link>
          ))}
        </nav>

        {/* ------------------------------------------------------ the panel */}
        <div className="setpanel">
          {tab === "details" && (
            <>
            {/* Sibling, not child. The cover button sits inside the card
                below but belongs to this form via its `form` attribute —
                a form nested in a form is invalid HTML and the browser
                throws the inner one away. */}
            <form action={uploadCover} id="cover-form">
              <input type="hidden" name="event_id" value={id} />
            </form>

            <form action={saveDetails} id="ev-settings">
              <input type="hidden" name="event_id" value={id} />
              <input type="hidden" name="leg_id" value={leg?.id ?? ""} />
              <input type="hidden" name="timezone" value={tz} />
              <input
                type="hidden"
                name="start_time"
                value={leg ? timeIn(leg.starts_at, tz) : "00:00"}
              />

              <div className="card">
                <div className="setcard-head">
                  <div>
                    <h2>Event Details</h2>
                    <p className="t-sub">Update the basic information about your event.</p>
                  </div>
                  <CoverUpload formId="cover-form" src={`/api/events/${id}/cover`} />
                </div>

                <div className="fgrid">
                  <div className="fieldset">
                    <label className="flabel" htmlFor="name">Event Name</label>
                    <input id="name" className="field" name="name" defaultValue={s.name} required />
                  </div>
                  <div className="fieldset">
                    <label className="flabel" htmlFor="event_type">Event Type</label>
                    <select id="event_type" className="field" name="event_type" defaultValue={s.event_type}>
                      {s.event_types.map((t) => (
                        <option key={t} value={t}>{titleCase(t)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="fieldset">
                    <label className="flabel" htmlFor="event_date">Event Date</label>
                    <input
                      id="event_date" className="field" name="event_date" type="date"
                      defaultValue={leg ? dateIn(leg.starts_at, tz) : ""}
                    />
                  </div>
                  <div className="fieldset">
                    <label className="flabel" htmlFor="end_date">End Date (Optional)</label>
                    <input
                      id="end_date" className="field" name="end_date" type="date"
                      defaultValue={s.end_date ? s.end_date.slice(0, 10) : ""}
                    />
                  </div>
                </div>

                <DescriptionField value={s.description ?? ""} />
                <TagEditor value={s.tags} />
              </div>
            </form>
            </>
          )}

          {tab === "venue" && (
            <form action={saveVenue} id="ev-settings">
              <input type="hidden" name="event_id" value={id} />
              <input type="hidden" name="leg_id" value={leg?.id ?? ""} />
              <input
                type="hidden"
                name="event_date"
                value={leg ? dateIn(leg.starts_at, tz) : ""}
              />

              <div className="card">
                <div className="setcard-head">
                  <div>
                    <h2>Venue &amp; Time</h2>
                    <p className="t-sub">Manage the venue location and event schedule.</p>
                  </div>
                </div>

                {leg ? (
                  <>
                    <div className="fgrid">
                      <div className="fieldset">
                        <label className="flabel" htmlFor="venue_name">Venue Name</label>
                        <input
                          id="venue_name" className="field" name="venue_name"
                          defaultValue={leg.venue_name ?? ""} placeholder="The Grand Palace"
                        />
                      </div>
                      <div className="fieldset wide">
                        <label className="flabel" htmlFor="address_line">Venue Address</label>
                        <input
                          id="address_line" className="field" name="address_line"
                          defaultValue={leg.address_line ?? ""}
                          placeholder="123 Celebration Avenue, Victoria Island, Lagos"
                        />
                      </div>
                    </div>

                    <div className="fgrid three">
                      <div className="fieldset">
                        <label className="flabel" htmlFor="start_time">Start Time</label>
                        <input
                          id="start_time" className="field" name="start_time" type="time"
                          defaultValue={timeIn(leg.starts_at, tz)}
                        />
                      </div>
                      <div className="fieldset">
                        <label className="flabel" htmlFor="end_time">End Time</label>
                        <input
                          id="end_time" className="field" name="end_time" type="time"
                          defaultValue={leg.doors_close_at ? timeIn(leg.doors_close_at, tz) : ""}
                        />
                      </div>
                      <div className="fieldset">
                        <label className="flabel" htmlFor="timezone">Time Zone</label>
                        <select id="timezone" className="field" name="timezone" defaultValue={tz}>
                          {ZONES.map((z) => (
                            <option key={z.id} value={z.id}>{z.label}</option>
                          ))}
                          {!ZONES.some((z) => z.id === tz) && <option value={tz}>{tz}</option>}
                        </select>
                      </div>
                    </div>

                    <label className="allday">
                      <span className="switch">
                        <input type="checkbox" name="all_day" defaultChecked={leg.all_day} />
                        <span />
                      </span>
                      All day event
                    </label>
                    <p className="sub sm">
                      Guests see the date rather than a time. The start time is
                      still what the gate opens on.
                    </p>
                  </>
                ) : (
                  <p className="empty">This event has no ceremony yet.</p>
                )}
              </div>
            </form>
          )}

          {tab === "rsvp" && (
            <div className="card">
              <div className="setcard-head">
                <div>
                  <h2>RSVP Settings</h2>
                  <p className="t-sub">Whether replies are required, and by when.</p>
                </div>
              </div>
              <Toggle
                eventId={id} tab="rsvp" field="require_rsvp" on={s.require_rsvp}
                label="Require an RSVP before entry"
                detail={
                  s.require_rsvp
                    ? `On. ${c.never_replied_people} ${c.never_replied_people === 1 ? "person who has" : "people who have"} not replied will be stopped at the gate.`
                    : c.never_replied_people > 0
                      ? `Off. ${c.never_replied_people} people never replied and would be stopped at the gate if you turn this on.`
                      : "Off. Guests who never replied are still admitted — most Nigerian guests simply turn up."
                }
              />
              <form action={updateEvent} className="setrow">
                <input type="hidden" name="event_id" value={id} />
                <input type="hidden" name="field" value="rsvp_deadline" />
                <input type="hidden" name="tab" value="rsvp" />
                <div className="setmain">
                  <div className="setlabel">Reply by</div>
                  <div className="setdetail">
                    Guests can change their reply until this date. Leave it empty
                    and they can change it any time.
                  </div>
                </div>
                <input
                  className="field narrow-date" name="value" type="date"
                  defaultValue={s.rsvp_deadline ? s.rsvp_deadline.slice(0, 10) : ""}
                  aria-label="Reply by"
                />
                <button className="ghost" type="submit">Save</button>
              </form>
              <p className="sub sm">
                A household invited for four can always reply that only three will
                come — that partial number is what the caterer needs, so it counts
                as confirmed.
              </p>
            </div>
          )}

          {tab === "checkin" && (
            <div className="card">
              <div className="setcard-head">
                <div>
                  <h2>Check-in Settings</h2>
                  <p className="t-sub">How your ushers should handle the awkward cases.</p>
                </div>
              </div>
              <Toggle
                eventId={id} tab="checkin" field="allow_overflow" on={s.allow_overflow}
                label="Allow more people than invited"
                detail={
                  s.allow_overflow
                    ? c.overflow_parties > 0
                      ? `Currently on. ${c.overflow_parties} ${c.overflow_parties === 1 ? "party has" : "parties have"} come with extra people — ${c.overflow_people} in all.`
                      : "Currently on. Extra guests are admitted and flagged for you, rather than argued with at the door."
                    : "Off. An usher must call a manager before admitting anyone over the invitation."
                }
              />
              <Toggle
                eventId={id} tab="checkin" field="allow_walkins" on={s.allow_walkins}
                label="Let ushers add walk-ins"
                detail={
                  s.allow_walkins
                    ? `On. Anyone added at the gate is flagged in your report${c.walk_ins > 0 ? ` — ${c.walk_ins} so far` : ""}. A walk-in is admitted even if it takes you past your plan; we invoice afterwards.`
                    : "Off. Anyone not on the list is turned away."
                }
              />
              <Toggle
                eventId={id} tab="checkin" field="allow_usher_undo" on={s.allow_usher_undo}
                label="Let ushers undo their own check-ins"
                detail="On, for 30 seconds after a scan. Mis-taps happen; corrections are logged, never deleted."
              />
              <form action={updateEvent} className="setrow">
                <input type="hidden" name="event_id" value={id} />
                <input type="hidden" name="field" value="manager_phone" />
                <input type="hidden" name="tab" value="checkin" />
                <div className="setmain">
                  <div className="setlabel">Call manager</div>
                  <div className="setdetail">
                    The number an usher taps when they cannot admit someone. On
                    the day this is usually the planner or the chief usher, not
                    you — it is carried offline and opens the phone&rsquo;s dialler.
                  </div>
                </div>
                <input
                  className="field narrow-date" name="value" type="tel"
                  placeholder="+2348034112098" defaultValue={s.manager_phone ?? ""}
                  aria-label="Call manager number"
                />
                <button className="ghost" type="submit">Save</button>
              </form>
            </div>
          )}

          {tab === "passes" && (
            <div className="card">
              <div className="setcard-head">
                <div>
                  <h2>QR Pass Settings</h2>
                  <p className="t-sub">
                    One pass per household, issued at invitation — many guests
                    simply turn up, and the gate has to know them.
                  </p>
                </div>
              </div>
              <div className="setrow">
                <div className="setmain">
                  <div className="setlabel">Passes in circulation</div>
                  <div className="setdetail">
                    {c.active_passes} active {c.active_passes === 1 ? "pass" : "passes"}
                    {c.invitations_sent > 0
                      ? `, ${c.invitations_sent} already sent to guests.`
                      : ". None have been sent yet."}
                  </div>
                </div>
                <Link className="ghost" href={`/events/${id}/passes`}>Open QR passes</Link>
              </div>
              <div className="setrow">
                <div className="setmain">
                  <div className="setlabel">Reissue every pass</div>
                  <div className="setdetail">
                    Kills all {c.active_passes} existing{" "}
                    {c.active_passes === 1 ? "pass" : "passes"} and creates new
                    ones. Only if you think codes have been shared widely.
                    Everyone must be sent their link again.
                  </div>
                </div>
              </div>
              <form action={reissuePasses} className="form-row">
                <input type="hidden" name="event_id" value={id} />
                <input
                  className="field" name="confirm" placeholder="Type REISSUE to confirm"
                  aria-label="Type REISSUE to confirm"
                />
                <button className="ghost" type="submit">Reissue</button>
              </form>
            </div>
          )}

          {tab === "privacy" && (
            <form action={saveAccess}>
              <input type="hidden" name="event_id" value={id} />
              <div className="card">
                <div className="setcard-head">
                  <div>
                    <h2>Privacy &amp; Visibility</h2>
                    <p className="t-sub">Who can find this event, and who can get in.</p>
                  </div>
                </div>

                <div className="setrow">
                  <div className="setmain">
                    <div className="setlabel">Invitation only</div>
                    <div className="setdetail">
                      On. A pass is the only way through the gate, and a pass
                      exists only for a household you invited. Turning this off
                      does not yet open anything — the gate has no other way in.
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="invitation_only" defaultChecked={s.invitation_only} />
                    <span />
                  </label>
                </div>

                <div className="setrow">
                  <div className="setmain">
                    <div className="setlabel">Public event page</div>
                    <div className="setdetail">
                      Off by default, and that is deliberate: a guest list is the
                      private part of a wedding. On, anyone with the link below
                      sees the date, the venue and your description — never the
                      guest list, and never a pass.
                    </div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="public_page" defaultChecked={s.public_page} />
                    <span />
                  </label>
                </div>

                <div className="fieldset" style={{ marginTop: 6 }}>
                  <label className="flabel" htmlFor="slug">Custom link</label>
                  <div className="slugrow">
                    <span className="slug-prefix">{origin}/e/</span>
                    <input
                      id="slug" className="field" name="slug" defaultValue={s.slug ?? ""}
                      placeholder="ahmed-aisha-2025" pattern="[a-zA-Z0-9\-]*"
                    />
                  </div>
                  <p className="sub sm">
                    Lowercase letters, numbers and hyphens. Leave it empty and the
                    event has no public link at all.
                  </p>
                </div>

                <div className="form-row" style={{ marginTop: 14 }}>
                  <button className="primary" type="submit">Save access settings</button>
                </div>
              </div>
            </form>
          )}

          {tab === "advanced" && (
            <>
              <div className="card">
                <div className="setcard-head">
                  <div>
                    <h2>Advanced Settings</h2>
                    <p className="t-sub">The identifiers behind this event.</p>
                  </div>
                </div>
                <div className="setrow">
                  <div className="setmain">
                    <div className="setlabel">Event ID</div>
                    <div className="setdetail">
                      <code>{s.id}</code> — quote this if you ever ask us for help.
                    </div>
                  </div>
                </div>
                <div className="setrow">
                  <div className="setmain">
                    <div className="setlabel">Pass generation</div>
                    <div className="setdetail">
                      Version {s.token_version}. Every pass carries the version it
                      was signed under, and the scanner refuses any that does not
                      match — which is how reissuing kills old codes without a
                      revocation list.
                    </div>
                  </div>
                </div>
              </div>

              <div className="card danger">
                <div className="setcard-head">
                  <div>
                    <h2>Careful</h2>
                    <p className="t-sub">These affect guests immediately.</p>
                  </div>
                </div>

                <div className="setrow">
                  <div className="setmain">
                    <div className="setlabel">Cancel this event</div>
                    <div className="setdetail">
                      Guests see a cancellation notice on their invitation. Passes
                      stop working and the gate says why. Your data stays, and
                      this is reversible.
                    </div>
                  </div>
                  <form action={cancelEvent}>
                    <input type="hidden" name="event_id" value={id} />
                    <button className="ghost" type="submit" disabled={s.status === "cancelled"}>
                      {s.status === "cancelled" ? "Already cancelled" : "Cancel event"}
                    </button>
                  </form>
                </div>

                <div className="setrow" id="delete">
                  <div className="setmain">
                    <div className="setlabel">Delete this event</div>
                    <div className="setdetail">
                      Removes every household, {c.active_passes}{" "}
                      {c.active_passes === 1 ? "pass" : "passes"} and{" "}
                      {c.scans_recorded === 0
                        ? "the check-in history"
                        : `all ${c.scans_recorded} recorded ${c.scans_recorded === 1 ? "scan" : "scans"}`}
                      . This cannot be undone — the check-in log is otherwise
                      permanent, and this is the only thing that can erase it.
                    </div>
                  </div>
                </div>
                <form action={deleteEvent} className="form-row">
                  <input type="hidden" name="event_id" value={id} />
                  <input
                    className="field" name="confirm" placeholder="Type DELETE to confirm"
                    aria-label="Type DELETE to confirm"
                  />
                  <button className="danger-btn" type="submit">Delete This Event</button>
                </form>
              </div>
            </>
          )}

          {!current.built && (
            <div className="card">
              <div className="setcard-head">
                <div>
                  <h2>{current.label}</h2>
                  <p className="t-sub">Not built yet.</p>
                </div>
              </div>
              <p className="sub" style={{ maxWidth: "60ch" }}>{current.coming}</p>
              <p className="sub sm">
                It has a place here so you can see where it will live. There are
                no switches on this tab because a switch that does nothing is
                worse than an empty page.
              </p>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- the rail */}
        <aside className="rail">
          <div className="card railcard">
            <div className="rail-head">
              <h3>Event Status</h3>
              <span className={`statusdot${published ? " on" : ""}`}>
                {published ? "Published" : s.status === "cancelled" ? "Cancelled" : "Draft"}
              </span>
            </div>
            <p className="sub sm">
              {published
                ? "Your event is live and visible to invited guests."
                : s.status === "cancelled"
                  ? "Guests see a cancellation notice. Publish again to undo it."
                  : "Only you can see this event. Guests cannot open their invitation yet."}
            </p>
            <form action={setPublished}>
              <input type="hidden" name="event_id" value={id} />
              <input type="hidden" name="tab" value={tab} />
              <input type="hidden" name="publish" value={published ? "0" : "1"} />
              <button className={`wide-btn${published ? " warn" : " go"}`} type="submit">
                {published ? "Unpublish Event" : "Publish Event"}
              </button>
            </form>
          </div>

          <div className="card railcard">
            <h3>Event Link</h3>
            <p className="sub sm">Share this link to invite guests or promote your event.</p>
            {publicUrl ? (
              <CopyLink url={publicUrl} />
            ) : (
              <p className="sub sm none">No link yet — give this event one below.</p>
            )}
            <Link className="rail-link" href={`/events/${id}/settings?tab=privacy`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
              </svg>
              Customize Link
            </Link>
          </div>

          <div className="card railcard">
            <h3>Guest Access</h3>
            <div className="accrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3" />
              </svg>
              <div>
                <strong>Invitation Only</strong>
                <small>Only invited guests can view event details</small>
              </div>
              <Check on={s.invitation_only} />
            </div>
            <div className="accrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16v14H4zM8 11l3 3 5-6" />
              </svg>
              <div>
                <strong>RSVP Required</strong>
                <small>Guests must respond to invitations</small>
              </div>
              <Check on={s.require_rsvp} />
            </div>
            <div className="accrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18-2.5-2.7-2.5-15.3 0-18" />
              </svg>
              <div>
                <strong>Public Event Page</strong>
                <small>
                  {s.public_page
                    ? "Anyone with the link can see the event page"
                    : "Event page is not publicly accessible"}
                </small>
              </div>
              <Check on={s.public_page} />
            </div>
          </div>

          <div className="card railcard danger">
            <h3>Danger Zone</h3>
            <div className="dz">
              <strong>Delete Event</strong>
              <small>
                Once you delete an event, there is no going back. Please be certain.
              </small>
              {/* Sends you to the typed confirmation rather than deleting from
                  here. Deleting is the only thing in the product that can erase
                  the append-only check-in log, and a single click in a sidebar
                  is not enough to ask for that. */}
              <Link className="wide-btn danger" href={`/events/${id}/settings?tab=advanced#delete`}>
                Delete This Event
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <div className="savebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
        </svg>
        <div>
          <strong>
            {batched ? "Changes on this tab save together" : "Changes here save as you make them"}
          </strong>
          <small>
            {batched
              ? "Edit as much as you like, then press Save Changes. Nothing on this tab is stored until you do."
              : "Each switch saves on its own, so a change to one policy can never carry another one along with it."}
          </small>
        </div>
      </div>
    </>
  );
}
