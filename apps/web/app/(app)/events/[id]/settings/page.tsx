import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/org-api";
import {
  cancelEvent,
  deleteEvent,
  reissuePasses,
  updateEvent,
  updateLeg,
} from "./actions";

/**
 * Event settings, per mockups/organiser-plans-reports-team.html:
 * The basics · At the gate · Replies · Careful.
 *
 * Every toggle says what it would cost *right now* — "Off. 81 people never
 * replied and would be stopped at the gate if you turn this on." A switch
 * with a number beside it is a decision; a switch on its own is a guess.
 */

type Settings = {
  id: string;
  name: string;
  status: string;
  allow_overflow: boolean;
  require_rsvp: boolean;
  allow_walkins: boolean;
  allow_usher_undo: boolean;
  rsvp_deadline: string | null;
  manager_phone: string | null;
  token_version: number;
  legs: {
    id: string;
    name: string;
    starts_at: string;
    venue_name: string | null;
    address_line: string | null;
    city: string | null;
  }[];
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

/** A toggle that saves itself, with the consequence written underneath. */
function Toggle({
  eventId,
  field,
  on,
  label,
  detail,
}: {
  eventId: string;
  field: string;
  on: boolean;
  label: string;
  detail: string;
}) {
  return (
    <form action={updateEvent} className="setrow">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="field" value={field} />
      <div className="setmain">
        <div className="setlabel">{label}</div>
        <div className="setdetail">{detail}</div>
      </div>
      {/* The checkbox gets its own name and no hidden partner: an
          unchecked box simply isn't submitted, which is exactly the
          semantic we want. Pairing a hidden "off" field with a checkbox of
          the SAME name looks equivalent but isn't — FormData.get() returns
          the first value, so the hidden one always wins and the toggle
          silently never turns on. */}
      <label className="switch">
        <input type="checkbox" name="on" defaultChecked={on} />
        <span />
      </label>
      <button className="ghost" type="submit">
        Save
      </button>
    </form>
  );
}

function localInput(iso: string) {
  // datetime-local wants "YYYY-MM-DDTHH:mm" in the viewer's terms; the
  // event's own timezone is what an organiser means.
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Africa/Lagos",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: s } = await api<Settings>(`/events/${id}/settings`);
  if (status !== 200) notFound();
  const c = s.consequences;
  const leg = s.legs[0];

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {s.name}
        </Link>
      </p>
      <h1 className="page">Event settings</h1>

      {sp.saved && <div className="plan-line">Saved.</div>}
      {sp.error && (
        <p className="form-error">
          That didn&rsquo;t save. If you were confirming something, the word
          has to match exactly.
        </p>
      )}
      {s.status === "cancelled" && (
        <div className="unassigned">
          <div>
            <div className="t">This event is cancelled</div>
            <div className="s">
              Guests see a cancellation notice and passes no longer open the
              gate. Everything is still here — set it back to active to undo.
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- the basics */}
      <div className="card">
        <h2>The basics</h2>
        <p className="t-sub" style={{ marginBottom: 14 }}>
          Changing the date or venue updates every guest&rsquo;s invitation
          page straight away.
        </p>
        <form action={updateEvent}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="field" value="name" />
          <div className="form-row">
            <input className="field" name="value" defaultValue={s.name} required />
            <button className="ghost" type="submit">
              Save name
            </button>
          </div>
        </form>
        {/* The number an usher taps when they cannot admit someone. Not
            the account owner's by default: on the day it is usually the
            planner or the chief usher who should pick up. */}
        <form action={updateEvent} style={{ marginTop: 12 }}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="field" value="manager_phone" />
          <div className="form-row">
            <input
              className="field"
              name="value"
              type="tel"
              placeholder="Who ushers call, e.g. +2348034112098"
              defaultValue={s.manager_phone ?? ""}
            />
            <button className="ghost" type="submit">
              Save number
            </button>
          </div>
        </form>
        {leg && (
          <form action={updateLeg} style={{ marginTop: 12 }}>
            <input type="hidden" name="event_id" value={id} />
            <input type="hidden" name="leg_id" value={leg.id} />
            <div className="form-row">
              <input
                className="field"
                name="starts_at"
                type="datetime-local"
                defaultValue={localInput(leg.starts_at)}
                aria-label="Date and time"
              />
              <input
                className="field"
                name="venue_name"
                defaultValue={leg.venue_name ?? ""}
                placeholder="Venue"
                aria-label="Venue"
              />
              <input
                className="field"
                name="city"
                defaultValue={leg.city ?? ""}
                placeholder="City"
                aria-label="City"
              />
              <button className="ghost" type="submit">
                Save
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ---------------------------------------------------- at the gate */}
      <div className="card">
        <h2>At the gate</h2>
        <p className="t-sub" style={{ marginBottom: 6 }}>
          How your ushers should handle the awkward cases.
        </p>

        <Toggle
          eventId={id}
          field="allow_overflow"
          on={s.allow_overflow}
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
          eventId={id}
          field="require_rsvp"
          on={s.require_rsvp}
          label="Require an RSVP before entry"
          detail={
            s.require_rsvp
              ? `On. ${c.never_replied_people} ${c.never_replied_people === 1 ? "person who has" : "people who have"} not replied will be stopped at the gate.`
              : c.never_replied_people > 0
                ? `Off. ${c.never_replied_people} people never replied and would be stopped at the gate if you turn this on.`
                : "Off. Guests who never replied are still admitted — most Nigerian guests simply turn up."
          }
        />
        <Toggle
          eventId={id}
          field="allow_walkins"
          on={s.allow_walkins}
          label="Let ushers add walk-ins"
          detail={
            s.allow_walkins
              ? `On. Anyone added at the gate is flagged in your report${c.walk_ins > 0 ? ` — ${c.walk_ins} so far` : ""}. A walk-in is admitted even if it takes you past your plan; we invoice afterwards.`
              : "Off. Anyone not on the list is turned away."
          }
        />
        <Toggle
          eventId={id}
          field="allow_usher_undo"
          on={s.allow_usher_undo}
          label="Let ushers undo their own check-ins"
          detail="On, for 30 seconds after a scan. Mis-taps happen; corrections are logged, never deleted."
        />
      </div>

      {/* ------------------------------------------------------- replies */}
      <div className="card">
        <h2>Replies</h2>
        <form action={updateEvent}>
          <input type="hidden" name="event_id" value={id} />
          <input type="hidden" name="field" value="rsvp_deadline" />
          <div className="setmain" style={{ marginBottom: 10 }}>
            <div className="setlabel">Reply by</div>
            <div className="setdetail">
              Guests can change their reply until this date. Leave it empty and
              they can change it any time.
            </div>
          </div>
          <div className="form-row">
            <input
              className="field"
              name="value"
              type="date"
              defaultValue={s.rsvp_deadline ? s.rsvp_deadline.slice(0, 10) : ""}
              aria-label="Reply by"
            />
            <button className="ghost" type="submit">
              Save
            </button>
          </div>
        </form>
        <p className="sub">
          A household invited for four can always reply that only three will
          come — that partial number is what the caterer needs, so it counts as
          confirmed.
        </p>
      </div>

      {/* ------------------------------------------------------- careful */}
      <div className="card" style={{ borderColor: "var(--err)" }}>
        <h2 style={{ color: "var(--err)" }}>Careful</h2>
        <p className="t-sub" style={{ marginBottom: 16 }}>
          These affect guests immediately.
        </p>

        <div className="setmain">
          <div className="setlabel">Reissue every pass</div>
          <div className="setdetail">
            Kills all {c.active_passes} existing{" "}
            {c.active_passes === 1 ? "pass" : "passes"} and creates new ones.
            Only if you think codes have been shared widely. Everyone must be
            sent their link again.
          </div>
        </div>
        <form action={reissuePasses} style={{ marginTop: 10 }}>
          <input type="hidden" name="event_id" value={id} />
          <div className="form-row">
            <input
              className="field"
              name="confirm"
              placeholder="Type REISSUE to confirm"
              aria-label="Type REISSUE to confirm"
            />
            <button className="ghost" type="submit">
              Reissue
            </button>
          </div>
        </form>

        <hr className="setdiv" />

        <div className="setmain">
          <div className="setlabel">Cancel this event</div>
          <div className="setdetail">
            Guests see a cancellation notice on their invitation. Passes stop
            working. Your data stays.
          </div>
        </div>
        <form action={cancelEvent} style={{ marginTop: 10 }}>
          <input type="hidden" name="event_id" value={id} />
          <button className="ghost" type="submit" disabled={s.status === "cancelled"}>
            {s.status === "cancelled" ? "Already cancelled" : "Cancel event"}
          </button>
        </form>

        <hr className="setdiv" />

        <div className="setmain">
          <div className="setlabel">Delete this event</div>
          <div className="setdetail">
            Removes every household, {c.active_passes}{" "}
            {c.active_passes === 1 ? "pass" : "passes"} and{" "}
            {c.scans_recorded === 0
              ? "the check-in history"
              : `all ${c.scans_recorded} recorded ${c.scans_recorded === 1 ? "scan" : "scans"}`}
            . This cannot be undone — the check-in log is otherwise permanent,
            and this is the only thing that can erase it.
          </div>
        </div>
        <form action={deleteEvent} style={{ marginTop: 10 }}>
          <input type="hidden" name="event_id" value={id} />
          <div className="form-row">
            <input
              className="field"
              name="confirm"
              placeholder="Type DELETE to confirm"
              aria-label="Type DELETE to confirm"
            />
            <button className="ghost" type="submit">
              Delete
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
