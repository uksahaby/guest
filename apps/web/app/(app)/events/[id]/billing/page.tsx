import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import { startCheckout } from "./actions";

/**
 * Billing & Plans, to the mockup.
 *
 * The mockup was drawn against a different commercial model — yearly
 * subscriptions with renewals, tiered feature gating, saved cards, guest
 * credits. This product does not work that way and the difference is not
 * cosmetic, so the layout is the mockup's and the substance is the
 * product's:
 *
 *   One payment, per event. Nothing renews. `payments.paid_at` is a date a
 *   thing was bought, not the start of a cycle, and the pricing page on the
 *   public site already tells the world so.
 *
 *   Every feature is on every plan (HANDOFF §3, plans.ts). The mockup's
 *   per-tier feature lists — API access on Professional, branding on
 *   Premium — would be a pricing change, not a page. So each card carries
 *   the same list, which is the actual selling point rather than a
 *   compromise.
 *
 *   Prices come from the server, never from here. plans.ts is the only
 *   authority: a client that could name its own figure could buy the Grand
 *   plan for a naira.
 *
 * Three panels in the mockup have nothing behind them — saved payment
 * methods, invoices, and guest credits. They are drawn where the design
 * puts them and say plainly what they are, rather than showing a Visa
 * ending 4242 that does not exist. Payment Method is the interesting one:
 * "nothing is stored here" is not a gap, it is the design. Paystack holds
 * the card and we never see it, which is why this application has no card
 * data to lose.
 */

type Payment = {
  id: string;
  plan: string;
  amount_minor: number;
  price: string;
  currency: string;
  status: string;
  provider: string;
  provider_ref: string;
  created_at: string;
  paid_at: string | null;
};

type Billing = {
  plan: string;
  people_limit: number;
  billable_people: number;
  passes_issued: number;
  over_limit: boolean;
  amount_paid_minor: number;
  suggested_plan: string | null;
  purchased_at: string | null;
  payments: Payment[];
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

/**
 * The same on every card, because it is the same on every plan. The list
 * is the marketing page's, so the two cannot drift into contradicting each
 * other in front of the person deciding.
 */
const FEATURES = [
  "Every feature on every plan",
  "Unlimited ushers",
  "Unlimited gates",
  "Offline check-in",
  "Tables & seating",
  "Full report afterwards",
];

/** Highlighted on the public pricing table too — kept in step deliberately. */
const POPULAR = "standard";

const TABS = [
  { key: "plans", label: "Plans & Usage" },
  { key: "history", label: "Payment History" },
  { key: "invoices", label: "Invoices" },
] as const;

function naira(minor: number): string {
  return `₦${(minor / 100).toLocaleString("en-NG")}`;
}

function day(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

function Tick() {
  return (
    <svg className="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [{ status, data: event }, { data: b }] = await Promise.all([
    api<EventShape>(`/events/${id}`),
    api<Billing>(`/events/${id}/billing`),
  ]);
  if (status !== 200) notFound();

  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "plans";
  const current = b.plans.find((p) => p.current);
  const used = b.billable_people;
  const limit = b.people_limit;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const headroom = Math.max(0, limit - used);
  // The paid ladder. Free is a starting state, not something to buy, so it
  // is the current-plan panel's business and not a card.
  const cards = b.plans.filter((p) => p.amount_minor > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page">Billing &amp; Plans</h1>
          <p className="sub" style={{ marginTop: 2 }}>
            Manage this event&rsquo;s plan, usage and payments.
          </p>
        </div>
      </div>

      <nav className="tabs" aria-label="Billing sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/events/${id}/billing?tab=${t.key}`}
            className={t.key === tab ? "on" : undefined}
            aria-current={t.key === tab ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {sp.error && <div className="flash bad">{ERRORS[sp.error] ?? ERRORS.failed}</div>}

      <div className="grid-side">
        <div className="setpanel">
          {tab === "plans" && (
            <>
              {/* ------------------------------------- current plan & usage */}
              <div className="card">
                <h2>Current Plan &amp; Usage</h2>
                <div className="planrow">
                  <div className="planside">
                    <div className="planname">
                      <strong>{current?.name ?? "Free"} plan</strong>
                      <span className={`badge ${b.over_limit ? "declined" : "attending"}`}>
                        {b.over_limit ? "Over limit" : "Active"}
                      </span>
                    </div>
                    <p className="t-sub">
                      {b.amount_paid_minor > 0
                        ? `${naira(b.amount_paid_minor)} paid, one payment`
                        : "No payment yet"}
                      {" · "}
                      Up to {limit.toLocaleString("en-NG")} guests
                    </p>
                    <div className="head-actions" style={{ marginTop: 14 }}>
                      <a className="primary" href="#choose">Switch plan</a>
                      <Link className="ghost" href={`/events/${id}/billing?tab=history`}>
                        Payment history
                      </Link>
                    </div>
                  </div>

                  <div className="usage">
                    <div className="usage-top">
                      <span className="flabel" style={{ marginBottom: 0 }}>Guests used</span>
                      <span className="usage-pct">{pct}%</span>
                    </div>
                    <div className="usage-n">
                      <strong>{used.toLocaleString("en-NG")}</strong>
                      <span> / {limit.toLocaleString("en-NG")}</span>
                    </div>
                    <div className="meter">
                      <span
                        className={b.over_limit ? "over" : undefined}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <p className="sub sm">
                      {b.over_limit
                        ? `${(used - limit).toLocaleString("en-NG")} people past this plan. Nobody is turned away — we invoice afterwards.`
                        : `You can add ${headroom.toLocaleString("en-NG")} more guests on this plan.`}
                    </p>
                  </div>
                </div>
              </div>

              {/* A person counts once their invitation is SENT, which is the
                  one part of the billing model people get wrong. Saying it
                  here is worth more than a tooltip. */}
              <div className="infobar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
                </svg>
                <div>
                  <strong>Need more guests? Move up a plan.</strong>
                  <small>
                    A person counts when their invitation is sent, not when they
                    are imported — so a list of 500 on a 300 plan costs nothing
                    until you send. And nobody is ever stopped at the gate over
                    billing: extra people are admitted, flagged, and invoiced
                    afterwards.
                  </small>
                </div>
              </div>

              {/* --------------------------------------------- the chooser */}
              <div className="card" id="choose">
                <div className="setcard-head">
                  <div>
                    <h2>Choose the plan that&rsquo;s right for you</h2>
                    <p className="t-sub">
                      Priced by people, not invitations. One payment per event —
                      nothing renews and there is no subscription to cancel.
                    </p>
                  </div>
                </div>

                <div className="plangrid">
                  {cards.map((p) => {
                    const popular = p.code === POPULAR;
                    return (
                      <div className={`plancard${popular ? " popular" : ""}${p.current ? " on" : ""}`} key={p.code}>
                        <div className="plancard-head">
                          <strong>{p.name}</strong>
                          {popular && <span className="pop">Most popular</span>}
                        </div>
                        <p className="t-sub">{p.blurb}</p>
                        <div className="amt">
                          {p.price}
                          <span> / event</span>
                        </div>
                        <div className="upto">
                          Up to {p.people_limit.toLocaleString("en-NG")} guests
                        </div>
                        <ul className="feats">
                          {FEATURES.map((f) => (
                            <li key={f}><Tick />{f}</li>
                          ))}
                        </ul>
                        {p.current ? (
                          <span className="plan-btn current">Current plan</span>
                        ) : p.too_small ? (
                          <span className="plan-btn dim" title={`Your list already has ${used} people.`}>
                            Too small
                          </span>
                        ) : p.downgrade ? (
                          <span className="plan-btn dim" title="Already covered by the plan you have paid for.">
                            Included
                          </span>
                        ) : (
                          <form action={startCheckout}>
                            <input type="hidden" name="event_id" value={id} />
                            <input type="hidden" name="plan" value={p.code} />
                            <button className="plan-btn buy" type="submit">
                              Choose {p.name}
                            </button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                      <input className="field" name="email" type="email"
                        placeholder="you@example.com" required />
                      <button className="primary" type="submit">Continue to Paystack</button>
                    </div>
                  </form>
                </div>
              )}

              {/* Where the mockup puts "buy guest credits". We would rather
                  tell a planner to buy the cheaper thing (HANDOFF §3). */}
              <div className="infobar plain">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l2.5 5.5L20 9.5l-4 4 1 6-5-2.8L7 19.5l1-6-4-4 5.5-1z" />
                </svg>
                <div>
                  <strong>Planning weddings for a living?</strong>
                  <small>
                    There is a monthly Professional plan — but below roughly
                    sixteen events a year, paying per event is genuinely cheaper
                    and we would rather you did that. It starts with a
                    conversation, not a form.
                  </small>
                </div>
              </div>
            </>
          )}

          {/* ------------------------------------------- payment history */}
          {tab === "history" && (
            <div className="card">
              <div className="setcard-head">
                <div>
                  <h2>Payment History</h2>
                  <p className="t-sub">
                    Every attempt on this event, successful or not.
                  </p>
                </div>
              </div>
              {b.payments.length === 0 ? (
                <p className="empty">
                  Nothing has been charged for this event yet.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="list">
                    <thead>
                      <tr>
                        <th>Date</th><th>Plan</th><th>Amount</th>
                        <th>Status</th><th>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{day(p.paid_at ?? p.created_at)}</td>
                          <td className="t-name">
                            {p.plan.slice(0, 1).toUpperCase() + p.plan.slice(1)}
                          </td>
                          <td>{p.price}</td>
                          <td>
                            <span className={`badge ${p.status === "successful" ? "attending" : p.status === "failed" ? "declined" : "pending"}`}>
                              {p.status}
                            </span>
                          </td>
                          {/* What Paystack support asks for first. */}
                          <td><code>{p.provider_ref}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------- invoices */}
          {tab === "invoices" && (
            <div className="card">
              <div className="setcard-head">
                <div>
                  <h2>Invoices</h2>
                  <p className="t-sub">Not built yet.</p>
                </div>
              </div>
              <p className="sub" style={{ maxWidth: "60ch" }}>
                There is no invoice document to download. Paystack emails a
                receipt for every successful payment, and Payment History has
                the reference number on each one — which is what an accountant
                and Paystack support both actually ask for.
              </p>
              <p className="sub sm">
                A proper PDF invoice with your business details on it is worth
                building before charging companies rather than couples. It has
                a place here so you can see where it will live.
              </p>
              <Link className="ghost" href={`/events/${id}/billing?tab=history`}>
                Open Payment History
              </Link>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------- the rail */}
        <aside className="rail">
          <div className="card railcard">
            <h3>Billing summary</h3>
            <dl className="sumlist">
              <div><dt>Event</dt><dd>{event.name}</dd></div>
              <div><dt>Plan</dt><dd>{current?.name ?? "Free"}</dd></div>
              <div><dt>Billing</dt><dd>One payment, per event</dd></div>
              <div><dt>Amount paid</dt><dd>{naira(b.amount_paid_minor)}</dd></div>
              <div>
                <dt>Purchased</dt>
                <dd>{b.purchased_at ? day(b.purchased_at) : "—"}</dd>
              </div>
              {/* Where the mockup has "Next Renewal". There isn't one, and
                  saying so is more useful than a date we would have to
                  invent. */}
              <div><dt>Renews</dt><dd>Never — nothing recurring</dd></div>
            </dl>
          </div>

          <div className="card railcard">
            <h3>Payment method</h3>
            <p className="sub sm">
              None stored, by design. Paystack takes the card on its own page
              and we never see the number — which is why there is nothing here
              to leak, and nothing for you to keep up to date.
            </p>
          </div>

          <div className="card railcard">
            <h3>Guest credits</h3>
            <p className="sub sm">
              Not built. Extra people beyond your plan are admitted at the gate
              and invoiced afterwards, so there is nothing to buy in advance.
            </p>
          </div>

          <div className="card railcard">
            <h3>Need help?</h3>
            <p className="sub sm">
              Quote the reference from Payment History and the event id below —
              between them they identify any charge exactly.
            </p>
            <p className="sub sm"><code>{id}</code></p>
          </div>
        </aside>
      </div>
    </>
  );
}
