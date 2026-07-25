/**
 * The plan catalogue, from HANDOFF §3.
 *
 * This is the ONLY authority on what a plan costs. A checkout request names
 * a plan, never an amount — a client that could send its own figure could
 * buy the Grand plan for a naira.
 *
 * Prices are in kobo (bigint on the way to the database). Never a float:
 * ₦15,000 is 1_500_000, and 15000.00 * 100 is a rounding bug waiting for
 * the one event where it matters.
 *
 * Priced by PEOPLE, not invitations, and every feature is on every plan.
 */

export type PlanCode =
  | "free"
  | "small"
  | "standard"
  | "large"
  | "grand"
  | "professional"
  | "organisation";

export type Plan = {
  code: PlanCode;
  name: string;
  /** Headroom in people. A pass counts when its invitation is sent. */
  peopleLimit: number;
  amountMinor: number;
  /** One-off plans are per event; the rest are subscriptions. */
  perEvent: boolean;
  blurb: string;
};

const NAIRA = 100; // kobo per naira

export const PLANS: Record<PlanCode, Plan> = {
  free: {
    code: "free",
    name: "Free",
    peopleLimit: 150,
    amountMinor: 0,
    perEvent: true,
    blurb: "Try the whole thing",
  },
  small: {
    code: "small",
    name: "Small",
    peopleLimit: 300,
    amountMinor: 7_500 * NAIRA,
    perEvent: true,
    blurb: "An intimate wedding",
  },
  standard: {
    code: "standard",
    name: "Standard",
    peopleLimit: 600,
    amountMinor: 15_000 * NAIRA,
    perEvent: true,
    blurb: "Most Nigerian weddings",
  },
  large: {
    code: "large",
    name: "Large",
    peopleLimit: 1_200,
    amountMinor: 25_000 * NAIRA,
    perEvent: true,
    blurb: "A full hall",
  },
  grand: {
    code: "grand",
    name: "Grand",
    peopleLimit: 2_500,
    amountMinor: 40_000 * NAIRA,
    perEvent: true,
    blurb: "The whole town is coming",
  },
  // Subscriptions. Not purchasable through per-event checkout — the
  // pricing page says outright that below ~16 events a year one-offs are
  // cheaper, and Organisation starts with a conversation, not a form.
  professional: {
    code: "professional",
    name: "Professional",
    peopleLimit: 2_500,
    amountMinor: 25_000 * NAIRA,
    perEvent: false,
    blurb: "For planners, monthly",
  },
  organisation: {
    code: "organisation",
    name: "Organisation",
    peopleLimit: 100_000,
    amountMinor: 600_000 * NAIRA,
    perEvent: false,
    blurb: "Recurring programmes, multi-site",
  },
};

/** Per-event plans in ascending order — the pricing table's own order. */
export const ONE_OFF_PLANS: Plan[] = Object.values(PLANS).filter((p) => p.perEvent);

export function isPlanCode(v: unknown): v is PlanCode {
  return typeof v === "string" && v in PLANS;
}

/** The cheapest per-event plan that fits this many people, if any. */
export function smallestPlanFor(people: number): Plan | null {
  return ONE_OFF_PLANS.find((p) => p.peopleLimit >= people) ?? null;
}

/** Kobo → "₦15,000", for messages a human reads. */
export function formatNaira(amountMinor: number): string {
  return `₦${(amountMinor / NAIRA).toLocaleString("en-NG")}`;
}
