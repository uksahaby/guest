import { verifyToken, type EventKey } from "./token.ts";

/**
 * The check-in state machine.
 *
 * Deliberately pure: no database, no clock, no network. Everything it needs
 * arrives in the context. That is what lets the identical logic run on a
 * scanner phone with no signal and on the server when the queue syncs hours
 * later — and it is what makes the whole thing testable against the twelve
 * outcomes without standing up Postgres.
 *
 * Port of this file to Dart is the only logic duplicated across languages.
 * The test cases port with it.
 */

export type Rsvp = "pending" | "attending" | "partial" | "declined";

export type Outcome =
  | "needs_count"
  | "admitted"
  | "partial"
  | "overflow_admitted"
  | "manual"
  | "allowance_exhausted"
  | "invalid"
  | "wrong_event"
  | "wrong_leg"
  | "revoked"
  | "rsvp_blocked"
  | "rsvp_declined"
  | "overflow_blocked"
  | "event_cancelled"
  | "not_found";

export type Tone = "admit" | "hold" | "deny" | "ask";

/** One household's row in the scanner's local copy of the guest list. */
export type LocalInvitation = {
  passId: string;
  invitationId: string;
  eventId: string;
  legId: string;
  displayName: string;
  category: string | null;
  tableName: string | null;
  allowance: number;
  /** Derived locally: SUM(admitted_count) for this pass at this leg. */
  admitted: number;
  rsvp: Rsvp;
  revoked: boolean;
};

export type Policy = {
  allowOverflow: boolean;
  requireRsvp: boolean;
  /**
   * The organiser called the event off. Settings promises the guest a
   * cancellation notice AND that passes stop opening the gate, so this
   * refuses everything — the one refusal that outranks identifying who is
   * standing there, because the answer is the same for all of them.
   *
   * Not a billing block (HANDOFF §3 forbids those). Cancelling is a
   * deliberate act by the organiser, and reversible: set the event back to
   * active and every pass works again, because nothing was reissued.
   */
  eventCancelled: boolean;
};

export type Context = {
  currentEventId: string;
  currentLegId: string;
  policy: Policy;
  /** Keys for every event this usher works, not only the current one. */
  keys: EventKey[];
  /** Local lookup by pass id. Undefined means not in this leg's list. */
  find: (passId: string) => LocalInvitation | undefined;
  /** Usher permission. Off by default. */
  canOverrideRsvp: boolean;
};

export type ScanInput =
  | { kind: "scan"; raw: string; requestedCount?: number }
  /** Name search, then check in by hand. Skips all token checks. */
  | { kind: "manual"; passId: string; requestedCount?: number };

export type Decision = {
  outcome: Outcome;
  tone: Tone;
  /** Counts against allowance. Zero for every refusal. */
  admittedCount: number;
  headline: string;
  detail?: string;
  /** Household, when we could identify one. */
  invitation?: LocalInvitation;
  /** Remaining after this decision is applied. */
  remaining?: number;
  /** Present on needs_count — what the picker should offer. */
  choices?: number[];
  /** Whether to write a row. Refusals are logged; the count prompt is not. */
  log: boolean;
  /** Milliseconds before returning to the camera. null = wait for a human. */
  autoReturnMs: number | null;
  /** Offered under the result. */
  actions: string[];
};

const ADMIT_DWELL = 1500;
const PARTIAL_DWELL = 2500;

function deny(
  outcome: Outcome,
  headline: string,
  detail: string | undefined,
  actions: string[],
): Decision {
  return {
    outcome,
    tone: "deny",
    admittedCount: 0,
    headline,
    detail,
    log: true,
    autoReturnMs: null,
    actions,
  };
}

function hold(
  outcome: Outcome,
  headline: string,
  detail: string | undefined,
  actions: string[],
  invitation?: LocalInvitation,
): Decision {
  return {
    outcome,
    tone: "hold",
    admittedCount: 0,
    headline,
    detail,
    invitation,
    log: true,
    autoReturnMs: null,
    actions,
  };
}

export function decide(ctx: Context, input: ScanInput): Decision {
  let inv: LocalInvitation | undefined;

  // ---- 0. is there still an event? --------------------------------------
  // Ahead of the token checks on purpose: a cancelled event admits nobody,
  // so what they are holding does not matter, and an usher who has not
  // heard the news needs to be told the reason rather than "not a valid
  // pass". Manual check-in is refused too — otherwise Search by name is a
  // way around it.
  if (ctx.policy.eventCancelled) {
    return deny(
      "event_cancelled",
      "Event cancelled",
      "This event was called off. Nobody is being admitted — send them to the organiser.",
      ["Call manager", "Dismiss"],
    );
  }

  if (input.kind === "scan") {
    // ---- 1. decode + signature, against every held key -----------------
    const v = verifyToken(input.raw, ctx.keys);

    if (!v.ok) {
      if (v.reason === "stale_version") {
        return deny(
          "revoked",
          "Pass no longer valid",
          "This code was replaced. The guest needs their new link.",
          ["Search by name", "Dismiss"],
        );
      }
      return deny(
        "invalid",
        "Not a valid pass",
        "The code didn't verify. It may be a screenshot of something else, or damaged.",
        ["Search by name", "Dismiss"],
      );
    }

    // ---- 2. right event? ------------------------------------------------
    if (v.payload.eventId !== ctx.currentEventId) {
      return deny(
        "wrong_event",
        "Pass is for another event",
        `This pass belongs to ${v.matched.eventName}.`,
        ["Dismiss"],
      );
    }

    // ---- 3. on this leg's list? -----------------------------------------
    inv = ctx.find(v.payload.passId);
    if (!inv) {
      // Genuine pass for this event, but not invited to the leg being
      // scanned — the Abuja list at the Lagos gate.
      return deny(
        "wrong_leg",
        "Not invited to this one",
        "This pass is for a different part of the event.",
        ["Search by name", "Dismiss"],
      );
    }
  } else {
    inv = ctx.find(input.passId);
    if (!inv) {
      return deny("not_found", "No matching guest", "Nothing on the list for this event.", [
        "Add walk-in",
        "Dismiss",
      ]);
    }
  }

  // ---- 4. revoked --------------------------------------------------------
  if (inv.revoked) {
    return deny("revoked", "Pass revoked", `${inv.displayName} was removed from the guest list.`, [
      "Call manager",
      "Dismiss",
    ]);
  }

  // ---- 5. RSVP gate ------------------------------------------------------
  if (inv.rsvp === "declined") {
    return hold(
      "rsvp_declined",
      "They replied no",
      `${inv.displayName} declined this invitation.`,
      ctx.canOverrideRsvp ? ["Admit anyway", "Dismiss"] : ["Call manager", "Dismiss"],
      inv,
    );
  }
  if (ctx.policy.requireRsvp && inv.rsvp === "pending") {
    return hold(
      "rsvp_blocked",
      "No reply on file",
      "This event requires an RSVP before entry.",
      ctx.canOverrideRsvp ? ["Admit anyway", "Dismiss"] : ["Call manager", "Dismiss"],
      inv,
    );
  }

  // ---- 6. allowance ------------------------------------------------------
  const remaining = Math.max(0, inv.allowance - inv.admitted);

  if (remaining === 0 && !ctx.policy.allowOverflow) {
    return hold(
      "allowance_exhausted",
      "Party fully admitted",
      `${inv.admitted} of ${inv.allowance} already in.`,
      ["Call manager", "Dismiss"],
      inv,
    );
  }

  // ---- 7. how many arrived? ---------------------------------------------
  const asked = input.requestedCount;

  if (asked === undefined) {
    // Allowance of one needs no prompt. This is most guests, and this path
    // must never gain a tap.
    if (inv.allowance === 1 && remaining === 1) {
      return applyAdmission(ctx, inv, 1, input.kind, remaining);
    }
    if (remaining === 0) {
      // Overflow is allowed, so offer it rather than refusing outright.
      return {
        outcome: "needs_count",
        tone: "ask",
        admittedCount: 0,
        headline: inv.displayName,
        detail: `${inv.admitted} of ${inv.allowance} already admitted. Anyone else is over the invitation.`,
        invitation: inv,
        remaining: 0,
        choices: [1, 2, 3],
        log: false,
        autoReturnMs: null,
        actions: [],
      };
    }
    return {
      outcome: "needs_count",
      tone: "ask",
      admittedCount: 0,
      headline: inv.displayName,
      detail: [inv.category, inv.tableName].filter(Boolean).join(" · ") || undefined,
      invitation: inv,
      remaining,
      // Pre-selected at the full remaining count by the UI, so the common
      // case stays one tap.
      choices: Array.from({ length: remaining }, (_, i) => i + 1),
      log: false,
      autoReturnMs: null,
      actions: [],
    };
  }

  if (asked < 1) {
    return deny("invalid", "Nothing to admit", "Count must be at least one.", ["Dismiss"]);
  }

  return applyAdmission(ctx, inv, asked, input.kind, remaining);
}

function applyAdmission(
  ctx: Context,
  inv: LocalInvitation,
  count: number,
  kind: "scan" | "manual",
  remaining: number,
): Decision {
  const over = Math.max(0, count - remaining);

  if (over > 0 && !ctx.policy.allowOverflow) {
    return deny(
      "overflow_blocked",
      "More people than invited",
      `Invited for ${inv.allowance}, ${inv.admitted + count} would be in. A manager must raise the invitation.`,
      ["Call manager", "Dismiss"],
    );
  }

  const after = Math.max(0, inv.allowance - (inv.admitted + count));

  if (over > 0) {
    return {
      outcome: "overflow_admitted",
      tone: "hold",
      admittedCount: count,
      headline: `${count} admitted · ${over} over`,
      detail: `${inv.displayName} was invited for ${inv.allowance}. The organiser has been notified.`,
      invitation: inv,
      remaining: 0,
      log: true,
      autoReturnMs: PARTIAL_DWELL,
      actions: ["Undo"],
    };
  }

  const outcome: Outcome =
    kind === "manual" ? "manual" : count < remaining ? "partial" : "admitted";

  const partial = after > 0;

  return {
    outcome,
    tone: "admit",
    admittedCount: count,
    headline: partial
      ? `${count} of ${inv.allowance} admitted`
      : kind === "manual"
        ? "Checked in by hand"
        : "Admitted",
    detail: [inv.displayName, inv.tableName].filter(Boolean).join(" · "),
    invitation: inv,
    remaining: after,
    log: true,
    // Longer when there is a number to read.
    autoReturnMs: partial ? PARTIAL_DWELL : ADMIT_DWELL,
    actions: ["Undo"],
  };
}
