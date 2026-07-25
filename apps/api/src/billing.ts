import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { asUser, sqlBilling, sqlRw, type Db } from "./db.ts";
import { env } from "./env.ts";
import {
  PLANS,
  ONE_OFF_PLANS,
  formatNaira,
  isPlanCode,
  smallestPlanFor,
} from "./plans.ts";
import type { PaymentProvider } from "./paystack.ts";

/**
 * Billing. Two rules from HANDOFF §3 run through everything here:
 *
 *   "Webhook-driven; never trust a client callback."
 *      A browser returning from Paystack proves nothing — it is just a
 *      redirect anyone can forge. Nothing upgrades a plan except a
 *      signed webhook, and the plan is applied from the amount the row
 *      was quoted at, not from anything the request carries.
 *
 *   "Walk-ins are admitted even when they exceed the plan. Flag it,
 *    invoice after. Never block a real person at a gate over billing."
 *      So over_limit is reported, loudly, and gates nothing.
 *
 * Amounts are kobo throughout, integers only.
 */

export async function billingRoutes(
  app: FastifyInstance,
  opts: { provider: PaymentProvider },
) {
  const { provider } = opts;
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  // ---- what this event owes ----------------------------------------------

  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/billing",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db) => {
        const { eventId } = req.params;
        const [ok] = await db`select app_manages_event(${eventId}::uuid) as ok`;
        if (ok?.ok !== true) return forbidden(reply);

        const [event] = await db`
          select plan, people_limit from events where id = ${eventId}`;

        // billable_people counts each household's LARGEST allowance across
        // legs, not the sum — six at the traditional and two at the white
        // wedding is six humans, not eight.
        const [counted] = await db`
          select billable_people(${eventId}::uuid) as billable`;
        const [issued] = await db`
          select count(*)::int as n
          from invitations i
          join invitation_deliveries d on d.invitation_id = i.id
          where i.event_id = ${eventId}`;
        const [paid] = await db`
          select coalesce(sum(amount_minor), 0)::bigint as total
          from payments
          where event_id = ${eventId} and status = 'successful'`;

        const billable = Number(counted!.billable);
        const limit = event!.people_limit as number;

        return {
          plan: event!.plan,
          people_limit: limit,
          billable_people: billable,
          passes_issued: issued!.n,
          over_limit: billable > limit,
          amount_paid_minor: Number(paid!.total),
          currency: "NGN",
          // Everything the plan chooser needs, priced by the server.
          suggested_plan: smallestPlanFor(billable)?.code ?? null,
          plans: ONE_OFF_PLANS.map((p) => ({
            code: p.code,
            name: p.name,
            blurb: p.blurb,
            people_limit: p.peopleLimit,
            amount_minor: p.amountMinor,
            price: formatNaira(p.amountMinor),
            /** Already covered — nothing to buy. */
            current: p.code === event!.plan,
            /** Too small for the list as it stands. */
            too_small: p.peopleLimit < billable,
            /**
             * Already included by a bigger plan already paid for. Checkout
             * refuses these, so the UI must not offer them.
             */
            downgrade: p.code !== event!.plan && p.peopleLimit <= limit,
          })),
        };
      }),
  );

  // ---- start a payment ----------------------------------------------------

  app.post<{
    Params: { eventId: string };
    Body: { plan?: string; provider?: string; email?: string };
  }>(
    "/events/:eventId/checkout",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const planCode = req.body?.plan;
      if (!isPlanCode(planCode)) {
        return reply.code(400).send({
          code: "bad_plan",
          message: "Unknown plan.",
        });
      }
      const plan = PLANS[planCode];
      if (!plan.perEvent) {
        return reply.code(400).send({
          code: "not_per_event",
          message: `${plan.name} is a subscription, not a per-event plan. Talk to us.`,
        });
      }
      if (plan.amountMinor === 0) {
        return reply.code(400).send({
          code: "nothing_to_pay",
          message: "The free plan costs nothing — there is no checkout.",
        });
      }
      if (req.body?.provider && req.body.provider !== "paystack") {
        return reply.code(400).send({
          code: "unsupported_provider",
          message: "Only Paystack is wired up so far.",
        });
      }

      const userId = uid(req);
      const { eventId } = req.params;

      const prepared = await asUser(sqlRw, userId, async (db) => {
        const [ok] = await db`select app_manages_event(${eventId}::uuid) as ok`;
        if (ok?.ok !== true) return { error: "forbidden" as const };

        const [event] = await db`
          select workspace_id, name, plan, people_limit
          from events where id = ${eventId}`;

        // Downgrades and re-buying what you already have are not payments.
        if (event!.people_limit >= plan.peopleLimit) {
          return { error: "no_upgrade" as const, current: event!.people_limit };
        }

        const [user] = await db`select email, phone from users where id = ${userId}`;
        // Paystack requires an email; this product's users are identified
        // by phone and may not have one, so checkout may ask for it.
        const email = (req.body?.email ?? user?.email ?? "").trim();
        if (!email || !email.includes("@")) {
          return { error: "email_required" as const };
        }

        // Our reference, generated before the provider is contacted, so a
        // webhook can always find its row.
        const reference = `evt_${eventId.replace(/-/g, "").slice(0, 12)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

        await db`
          insert into payments (workspace_id, event_id, provider, provider_ref,
            plan, people_limit, amount_minor, currency, status)
          values (${event!.workspace_id}, ${eventId}, ${provider.name}, ${reference},
            ${plan.code}::plan_code, ${plan.peopleLimit}, ${plan.amountMinor},
            'NGN', 'pending')`;

        return { reference, email, eventName: event!.name as string };
      });

      if ("error" in prepared) {
        if (prepared.error === "forbidden") return forbidden(reply);
        if (prepared.error === "email_required") {
          return reply.code(400).send({
            code: "email_required",
            message: "An email address is needed for the receipt.",
          });
        }
        return reply.code(409).send({
          code: "no_upgrade",
          message: `This event already covers ${prepared.current} people.`,
        });
      }

      try {
        const init = await provider.initialise({
          reference: prepared.reference,
          amountMinor: plan.amountMinor,
          email: prepared.email,
          callbackUrl: `${env.webUrl}/events/${eventId}/billing`,
          metadata: {
            event_id: eventId,
            event_name: prepared.eventName,
            plan: plan.code,
          },
        });
        return { authorization_url: init.authorizationUrl, reference: init.reference };
      } catch (err) {
        // The pending row stays: it is the audit trail of an attempt, and
        // nothing is charged without a webhook anyway.
        app.log.error({ err }, "payment initialise failed");
        return reply.code(502).send({
          code: "provider_unavailable",
          message: "Could not reach the payment provider. Nothing was charged.",
        });
      }
    },
  );

  // ---- the only thing that upgrades a plan --------------------------------

  app.post("/webhooks/paystack", async (req: FastifyRequest, reply) => {
    const raw = (req as { rawBody?: string }).rawBody ?? "";
    const signature = req.headers["x-paystack-signature"];

    if (!provider.verifySignature(raw, typeof signature === "string" ? signature : undefined)) {
      // Not from the provider — or the raw body was mangled in transit.
      // Say as little as possible.
      app.log.warn("rejected a webhook with a bad signature");
      return reply.code(401).send({ code: "bad_signature" });
    }

    const body = req.body as {
      event?: string;
      data?: { reference?: string; amount?: number; status?: string };
    } | null;

    const reference = body?.data?.reference;
    if (!reference) return reply.code(400).send({ code: "bad_payload" });

    // Acknowledge anything we do not act on: Paystack retries on non-2xx,
    // and retrying a charge.dispute forever helps nobody.
    if (body?.event !== "charge.success") {
      return reply.code(200).send({ ignored: body?.event ?? "unknown" });
    }

    const outcome = await applyPayment(reference, body.data?.amount);
    app.log.info({ reference, outcome }, "paystack webhook");
    // 200 even when already applied or unknown: a retry must not loop.
    return reply.code(200).send({ outcome });
  });

  app.log.info(
    { provider: provider.name, live: Boolean(env.paystackSecretKey) },
    "billing routes ready",
  );
}

/**
 * Applies a successful charge. Idempotent, and refuses to upgrade on an
 * amount that does not match what was quoted — a webhook is authenticated
 * but its numbers still get checked against our own row.
 */
async function applyPayment(
  reference: string,
  amountMinor: number | undefined,
): Promise<"applied" | "already_applied" | "unknown_reference" | "amount_mismatch"> {
  return sqlBilling.begin(async (tx) => {
    const db = tx as unknown as Db;
    const [payment] = await db`
      select id, event_id, plan, people_limit, amount_minor, status
      from payments
      where provider = 'paystack' and provider_ref = ${reference}
      for update`;

    if (!payment) return "unknown_reference";
    if (payment.status === "successful") return "already_applied";

    if (
      typeof amountMinor === "number" &&
      BigInt(amountMinor) !== BigInt(payment.amount_minor)
    ) {
      await db`
        update payments set status = 'failed' where id = ${payment.id}`;
      return "amount_mismatch";
    }

    await db`
      update payments set status = 'successful', paid_at = now()
      where id = ${payment.id}`;

    // The plan and headroom come from the row, quoted at checkout — never
    // from the webhook payload.
    const upgraded = await db`
      update events
      set plan = ${payment.plan}::plan_code,
          people_limit = ${payment.people_limit},
          paid_at = now()
      where id = ${payment.event_id}
      returning id`;

    // A policy that stops matching turns this into a silent no-op: money
    // taken, plan unchanged. Fail loudly instead so the provider retries
    // and someone sees it.
    if (upgraded.length === 0) {
      throw new Error(
        `payment ${payment.id} could not be applied to event ${payment.event_id}`,
      );
    }

    return "applied";
  }) as Promise<"applied" | "already_applied" | "unknown_reference" | "amount_mismatch">;
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({ code: "forbidden", message: "Not your event." });
}
