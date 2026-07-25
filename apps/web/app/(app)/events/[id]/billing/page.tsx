import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { startCheckout } from "./actions";

/**
 * "Choose a plan for this event", per
 * mockups/organiser-plans-reports-team.html.
 *
 * Priced by people, one payment per event, every feature on every plan —
 * and the page says outright that a planner running few events should keep
 * buying one-offs (HANDOFF §3: telling someone to buy the cheaper thing is
 * worth more than the margin).
 */

type Billing = {
  plan: string;
  people_limit: number;
  billable_people: number;
  passes_issued: number;
  over_limit: boolean;
  amount_paid_minor: number;
  suggested_plan: string | null;
  plans: {
    code: string;
    name: string;
    blurb: string;
    people_limit: number;
    amount_minor: number;
    price: string;
    current: boolean;
    too_small: boolean;
    downgrade: boolean;
  }[];
};

const ERRORS: Record<string, string> = {
  email_required:
    "Paystack needs an email address for the receipt — add one below and try again.",
  no_upgrade: "This event already covers that many people.",
  nothing_to_pay: "The free plan costs nothing.",
  not_per_event: "That plan is a subscription — talk to us instead.",
  provider_unavailable:
    "We couldn't reach Paystack just now. Nothing was charged — try again in a moment.",
  failed: "That didn't start. Nothing was charged.",
};

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [{ status, data: event }, { data: b }] = await Promise.all([
    api<EventShape>(`/events/${id}`),
    api<Billing>(`/events/${id}/billing`),
  ]);
  if (status !== 200) notFound();

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {event.name}
        </Link>
      </p>
      <h1 className="page">Choose a plan for this event</h1>
      <p className="sub">
        One payment, priced by people. Nothing renews, and every feature is on
        every plan.
      </p>

      {sp.error && <p className="form-error">{ERRORS[sp.error] ?? ERRORS.failed}</p>}

      <div className="plan-line">
        <b>
          {b.plan[0]?.toUpperCase() + b.plan.slice(1)} plan
        </b>{" "}
        — {b.billable_people} of {b.people_limit} people counted
        {b.passes_issued > 0
          ? ` · ${b.passes_issued} ${b.passes_issued === 1 ? "invitation" : "invitations"} sent`
          : ""}
        {b.amount_paid_minor > 0
          ? ` · ₦${(b.amount_paid_minor / 100).toLocaleString("en-NG")} paid`
          : ""}
        .
      </div>

      {b.over_limit && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <h2 style={{ color: "var(--warn)" }}>You&rsquo;re past the free limit</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            {b.billable_people} people are on the list and the plan covers{" "}
            {b.people_limit}. Nobody will be turned away at the gate over this —
            walk-ins are always admitted and we invoice afterwards — but
            choosing a plan now keeps the numbers honest.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Plans</h2>
        <table className="list">
          <thead>
            <tr>
              <th>Plan</th>
              <th>People</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {b.plans.map((p) => (
              <tr key={p.code}>
                <td>
                  <div className="t-name">
                    {p.name}
                    {p.code === b.suggested_plan && !p.current && (
                      <span className="badge attending" style={{ marginLeft: 8 }}>
                        Fits your list
                      </span>
                    )}
                  </div>
                  <div className="t-sub">{p.blurb}</div>
                </td>
                <td>{p.people_limit.toLocaleString("en-NG")}</td>
                <td>{p.amount_minor === 0 ? "Free" : p.price}</td>
                <td>
                  <div className="row-actions">
                    {p.current ? (
                      <span className="badge attending">Current</span>
                    ) : p.too_small ? (
                      <span className="badge not_sent">Too small</span>
                    ) : p.downgrade || p.amount_minor === 0 ? (
                      <span className="badge not_sent">Included</span>
                    ) : (
                      <form action={startCheckout}>
                        <input type="hidden" name="event_id" value={id} />
                        <input type="hidden" name="plan" value={p.code} />
                        <button className="ghost" type="submit">
                          Choose {p.name}
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sp.error === "email_required" && (
        <div className="card">
          <h2>Where should the receipt go?</h2>
          <form action={startCheckout}>
            <input type="hidden" name="event_id" value={id} />
            <input
              type="hidden"
              name="plan"
              value={b.suggested_plan && b.suggested_plan !== "free" ? b.suggested_plan : "standard"}
            />
            <div className="form-row">
              <input
                className="field"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
              />
              <button className="primary" type="submit">
                Continue to Paystack
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Planning weddings for a living?</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          There&rsquo;s a monthly Professional plan — but below roughly sixteen
          events a year, paying per event is genuinely cheaper and we&rsquo;d
          rather you did that.
        </p>
      </div>
    </>
  );
}
