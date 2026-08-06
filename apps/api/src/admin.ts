import type { FastifyInstance } from "fastify";
import { asAnon, asPlatform, PlatformNotConfigured, type Db } from "./db.ts";
import { env } from "./env.ts";
import { formatNaira } from "./plans.ts";

/**
 * The platform dashboard: our own business, not a customer's event.
 *
 * Everything here runs as app_admin (db/migrations/019), which can read
 * organisers, workspaces, events and payments and **cannot read a guest
 * list at all** — no grant exists on invitations, passes or check_in_events,
 * so a query that reaches for one fails instead of returning it. Guest
 * counts come back through admin_event_size(), a SECURITY DEFINER function
 * that counts without reading.
 *
 * That distinction is the whole design. An administrator needs to know an
 * event has 743 people to run the business; knowing that one of them is
 * Mrs Adeyemi on +2348034112098 is somebody else's wedding.
 *
 * Two figures the mockup shows are NOT here, because they would have to be
 * invented: storage used and bandwidth used. Nothing measures either. They
 * are absent rather than estimated.
 */

const DAY = 24 * 3600 * 1000;

type Sendable = { code: number; body: unknown };

const NOT_ADMIN: Sendable = {
  code: 403,
  // Deliberately the same shape as any other forbidden response: whether
  // platform administration exists at all is not something to confirm to
  // someone probing for it.
  body: { code: "forbidden", message: "Not found." },
};

/** Percentage change, guarding the divide-by-zero the first month always is. */
function delta(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

export async function adminRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  /**
   * The flag lives on users, which app_admin can read — but the check runs
   * as app_rw before any admin connection is opened, so a non-admin never
   * causes a query to be issued on the platform-wide role at all.
   */
  async function isAdmin(userId: string): Promise<boolean> {
    const [row] = await asAnon(
      (db) => db`select is_platform_admin from users where id = ${userId}`,
    );
    return row?.is_platform_admin === true;
  }

  app.get<{ Querystring: { days?: string } }>(
    "/admin/overview",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!(await isAdmin(uid(req)))) {
        return reply.code(NOT_ADMIN.code).send(NOT_ADMIN.body);
      }

      const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
      const since = new Date(Date.now() - days * DAY);
      const prevSince = new Date(Date.now() - 2 * days * DAY);

      let body;
      try {
        body = await asPlatform(async (db: Db) => {
          // ---- the four totals, each against the period before it ---------
          const [organisers] = await db`
            select
              count(*)::int as total,
              count(*) filter (where created_at >= ${since})::int as added,
              count(*) filter (where created_at >= ${prevSince}
                               and created_at < ${since})::int as before
            from workspaces`;

          const [events] = await db`
            select
              count(*)::int as total,
              count(*) filter (where created_at >= ${since})::int as added,
              count(*) filter (where created_at >= ${prevSince}
                               and created_at < ${since})::int as before
            from events`;

          const [users] = await db`
            select
              count(*)::int as total,
              count(*) filter (where created_at >= ${since})::int as added,
              count(*) filter (where created_at >= ${prevSince}
                               and created_at < ${since})::int as before
            from users`;

          const [revenue] = await db`
            select
              coalesce(sum(amount_minor), 0)::bigint as total,
              coalesce(sum(amount_minor) filter (where paid_at >= ${since}), 0)::bigint as added,
              coalesce(sum(amount_minor) filter (where paid_at >= ${prevSince}
                                                 and paid_at < ${since}), 0)::bigint as before
            from payments where status = 'successful'`;

          // ---- the revenue line, one point per day ------------------------
          // generate_series so a day with no payments is a zero on the chart
          // rather than a gap the line jumps over.
          const series = await db`
            select d::date as day,
                   coalesce(sum(p.amount_minor), 0)::bigint as amount_minor
            from generate_series(${since}::date, current_date, interval '1 day') d
            left join payments p
              on p.status = 'successful' and p.paid_at::date = d::date
            group by d order by d`;

          /**
           * Events by status. The schema stores draft/active/completed/
           * cancelled; the mockup shows Upcoming/Ongoing/Completed/Cancelled.
           * An active event is upcoming or ongoing depending on whether its
           * first ceremony has started, which is a date question rather than
           * a status one. Draft is kept as its own slice: hiding it would
           * make the ring disagree with Total Events sitting above it.
           */
          const byStatus = await db`
            with first_leg as (
              select event_id, min(starts_at) as starts_at
              from event_legs group by event_id
            )
            select
              case
                when e.status = 'cancelled' then 'cancelled'
                when e.status = 'completed' then 'completed'
                when e.status = 'draft'     then 'draft'
                when f.starts_at is null    then 'upcoming'
                when f.starts_at > now()    then 'upcoming'
                when f.starts_at + interval '1 day' > now() then 'ongoing'
                else 'completed'
              end as bucket,
              count(*)::int as n
            from events e
            left join first_leg f on f.event_id = e.id
            group by 1`;

          // ---- top organisers ---------------------------------------------
          // admin_event_size counts people without reading them; summed per
          // workspace through a lateral join.
          const top = await db`
            select
              w.id,
              w.name,
              w.is_implicit,
              count(distinct e.id)::int as events,
              coalesce(sum(sz.people), 0)::int as people,
              coalesce((
                select sum(p.amount_minor) from payments p
                where p.workspace_id = w.id and p.status = 'successful'
              ), 0)::bigint as revenue_minor,
              max(e.updated_at) as last_active
            from workspaces w
            left join events e on e.workspace_id = w.id
            left join lateral admin_event_size(e.id) sz on true
            group by w.id, w.name, w.is_implicit
            order by revenue_minor desc, events desc
            limit 8`;

          // ---- recent transactions ----------------------------------------
          const transactions = await db`
            select p.id, p.provider_ref, p.amount_minor, p.status, p.plan,
                   p.created_at, p.paid_at, w.name as organiser
            from payments p
            join workspaces w on w.id = p.workspace_id
            order by coalesce(p.paid_at, p.created_at) desc
            limit 8`;

          /**
           * Recent activity, assembled from what actually happened rather
           * than from an audit table — there isn't one. Three real events:
           * an organiser's first workspace, an event created, a payment
           * settled. Anything else the mockup lists would be invented.
           */
          const activity = await db`
            (select 'organiser' as kind, w.name as subject, null::text as detail,
                    w.created_at as at
               from workspaces w order by w.created_at desc limit 6)
            union all
            (select 'event', e.name, w.name, e.created_at
               from events e join workspaces w on w.id = e.workspace_id
               order by e.created_at desc limit 6)
            union all
            (select 'payment', w.name, p.amount_minor::text, p.paid_at
               from payments p join workspaces w on w.id = p.workspace_id
               where p.status = 'successful' and p.paid_at is not null
               order by p.paid_at desc limit 6)
            order by at desc limit 8`;

          const bucket = (name: string) =>
            Number(byStatus.find((r) => r.bucket === name)?.n ?? 0);

          return {
            period_days: days,
            totals: {
              organisers: {
                value: organisers!.total,
                change: delta(organisers!.added, organisers!.before),
              },
              events: {
                value: events!.total,
                change: delta(events!.added, events!.before),
              },
              users: {
                value: users!.total,
                change: delta(users!.added, users!.before),
              },
              revenue_minor: Number(revenue!.total),
              revenue: formatNaira(Number(revenue!.total)),
              revenue_change: delta(Number(revenue!.added), Number(revenue!.before)),
            },
            revenue_series: series.map((r) => ({
              day: r.day,
              amount_minor: Number(r.amount_minor),
            })),
            events_by_status: {
              total: events!.total,
              upcoming: bucket("upcoming"),
              ongoing: bucket("ongoing"),
              completed: bucket("completed"),
              cancelled: bucket("cancelled"),
              draft: bucket("draft"),
            },
            top_organisers: top.map((r) => ({
              id: r.id,
              name: r.name,
              is_implicit: r.is_implicit,
              events: r.events,
              people: r.people,
              revenue_minor: Number(r.revenue_minor),
              revenue: formatNaira(Number(r.revenue_minor)),
              last_active: r.last_active,
            })),
            transactions: transactions.map((r) => ({
              id: r.id,
              reference: r.provider_ref,
              organiser: r.organiser,
              plan: r.plan,
              amount_minor: Number(r.amount_minor),
              amount: formatNaira(Number(r.amount_minor)),
              status: r.status,
              at: r.paid_at ?? r.created_at,
            })),
            activity: activity.map((r) => ({
              kind: r.kind,
              subject: r.subject,
              detail: r.kind === "payment" && r.detail
                ? formatNaira(Number(r.detail))
                : r.detail,
              at: r.at,
            })),
            /**
             * Only what can actually be checked. The database answered or
             * this request would not exist; the others are configuration
             * questions with honest answers. Nothing here is a green light
             * because a mockup had one.
             */
            health: [
              { name: "Database", state: "operational",
                detail: "Answering — this page is proof" },
              { name: "Payment gateway", state: env.paystackSecretKey ? "operational" : "not_configured",
                detail: env.paystackSecretKey
                  ? (env.paystackSecretKey.startsWith("sk_live") ? "Paystack, live keys" : "Paystack, test keys")
                  : "No Paystack key — checkout uses the offline stub" },
              { name: "SMS", state: env.termiiApiKey ? "operational" : "not_configured",
                detail: env.termiiApiKey
                  ? "Termii" : "No provider — OTP codes go to the server log" },
              { name: "Email", state: "not_built",
                detail: "No email channel exists yet" },
              { name: "Error reporting", state: process.env.ERROR_WEBHOOK_URL ? "operational" : "not_configured",
                detail: process.env.ERROR_WEBHOOK_URL
                  ? "Webhook configured" : "Errors reach the log only" },
            ],
          };
        });

      } catch (err) {
        // The one failure worth naming rather than logging as a 500: the
        // platform role is not configured on this box. Everything else on
        // the API is working — only this page cannot be drawn.
        if (err instanceof PlatformNotConfigured) {
          req.log.warn({ err }, "admin dashboard asked for, app_admin not configured");
          return reply.code(503).send({
            code: "platform_not_configured",
            message:
              "The platform role is not set up on this server. Apply migration 019 " +
              "and set DATABASE_URL_APP_ADMIN — see DEPLOY.md.",
          });
        }
        throw err;
      }

      return reply.send(body);
    },
  );
}
