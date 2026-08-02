/**
 * Is this event ready, and if not, what should be done next.
 *
 * Implements `spec/event-readiness-rules.md`. Two things in that spec are
 * load-bearing and easy to lose:
 *
 *   · The headline is a WORD, not a percentage. "82% ready" tells an
 *     organiser nothing they can act on; "31 households have no invitation
 *     link → send invitations" does. The number belongs inside the
 *     sentence, which is the only progress bar this needs.
 *
 *   · A check stays hidden until it starts mattering. Showing twelve weeks
 *     of future tasks on day one is how a dashboard becomes something
 *     people stop opening.
 *
 * Pure, and tested directly — no database, no HTTP.
 */

/** Results that put someone through the gate. */
export const ADMITTING = [
  "admitted",
  "partial",
  "manual",
  "overflow_admitted",
  "re_entry",
];

export type ReadinessItem = {
  check: number;
  /** The fact, with its number first. */
  fact: string;
  /** What to do about it. */
  action: string;
  href: string;
  /** Past its urgent point — shown above the rest under "Due now". */
  urgent: boolean;
  /** Already satisfied. Kept so a checklist can show what is done. */
  done: boolean;
  /** For the checklist: when it becomes urgent, in days. */
  urgent_in: number;
};

export type ReadinessState =
  | "setting_up"
  | "on_track"
  | "needs_attention"
  | "ready"
  | "complete";

const DAY = 24 * 3600 * 1000;

/** Days from now until the event. Negative once it has happened. */
export function daysUntil(startsAt: Date | string | null): number {
  if (!startsAt) return 9999;
  return Math.ceil((new Date(startsAt).getTime() - Date.now()) / DAY);
}

export type ReadinessFacts = {
  eventId: string;
  hasDetails: boolean;
  invitations: number;
  linked: number;
  replied: number;
  unassigned: number;
  usesTables: boolean;
  entrances: number;
  staff: number;
  testScans: number;
  passes: number;
  peopleLimit: number;
};

export function readiness(
  days: number,
  f: ReadinessFacts,
): { state: ReadinessState; items: ReadinessItem[]; all: ReadinessItem[] } {
  const e = `/events/${f.eventId}`;

  // (check, passes, startsMattering, urgentAt, label, fact, action, href)
  const defs: [number, boolean, number, number, string, string, string, string][] = [
    [1, f.hasDetails, 9999, 9999, "Event details",
      "The event still needs a date or venue", "Finish setup", `${e}/settings`],
    [2, f.invitations > 0, 9999, 56, "Guest list started",
      "No guests on the list yet", "Add or import guests", `${e}/guests/import`],
    [3, f.invitations > 0 && f.linked / f.invitations >= 0.9, 42, 21,
      "Invitations sent",
      `${f.invitations - f.linked} households have no invitation link`,
      "Send invitations", `${e}/guests`],
    [4, f.invitations > 0 && f.replied / f.invitations >= 0.8, 21, 10,
      "Replies in",
      `${f.invitations - f.replied} households haven't replied`,
      "Send reminders", `${e}/guests`],
    [5, !f.usesTables || f.unassigned === 0, 14, 3, "Tables assigned",
      `${f.unassigned} confirmed guests have no table`,
      "Assign tables", `${e}/tables`],
    [6, f.entrances > 0, 7, 2, "Gates created",
      "No gate has been created", "Add a gate", `${e}/team`],
    [7, f.staff > 0, 7, 2, "Staff assigned",
      "Nobody is assigned to check guests in",
      "Invite check-in staff", `${e}/team`],
    [8, f.testScans > 0, 3, 1, "Test scan done",
      "No one has tested the scanner",
      "Ask staff to open the scanner", `${e}/team`],
    [9, f.passes <= f.peopleLimit, 9999, 9999, "Pass capacity",
      `${f.passes} passes issued against a limit of ${f.peopleLimit}`,
      "Upgrade the plan", `${e}/billing`],
  ];

  const all: ReadinessItem[] = [];
  const items: ReadinessItem[] = [];

  for (const [check, passes, startsAt, urgentAt, label, fact, action, href] of defs) {
    // A check for a feature the event does not use is not a task at all.
    if (check === 5 && !f.usesTables) continue;

    all.push({
      check,
      fact: passes ? label : fact,
      action,
      href,
      urgent: !passes && days <= urgentAt,
      done: passes,
      urgent_in: urgentAt,
    });

    if (passes) continue;
    if (days > startsAt) continue; // not yet its problem
    items.push({
      check, fact, action, href,
      urgent: days <= urgentAt,
      done: false,
      urgent_in: urgentAt,
    });
  }

  // Soonest-urgent first, which is not the same as check order.
  items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.check - b.check);

  let state: ReadinessState = "on_track";
  if (days < 0) state = "complete";
  else if (!f.hasDetails || f.invitations === 0) state = "setting_up";
  else if (items.some((i) => i.urgent)) state = "needs_attention";
  else if (items.length === 0 && days <= 7) state = "ready";

  return { state, items, all };
}
