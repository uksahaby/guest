import type { FastifyInstance } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * GET /legs/:legId/stream — arrivals as they happen.
 *
 * ONE Postgres LISTEN connection for the whole process, fanned out to
 * subscribers by leg. A listener per browser tab would put a connection
 * per open dashboard on the database, and on event day the couple, both
 * mothers and the planner all have it open.
 *
 * The stream sends ids-only notifications through a hub, then reads each
 * row back under the caller's own RLS context — so a subscriber sees only
 * legs they could have queried anyway.
 */

// ---------------------------------------------------------------- the hub

type Notice = { id: string };
type Listener = (n: Notice) => void;

const byLeg = new Map<string, Set<Listener>>();
let listening: Promise<void> | null = null;

async function ensureListening(app: FastifyInstance): Promise<void> {
  listening ??= sqlRw
    .listen("check_in", (raw) => {
      try {
        const { leg_id, id } = JSON.parse(raw) as { leg_id: string; id: string };
        const subs = byLeg.get(leg_id);
        if (!subs) return;
        for (const send of subs) send({ id });
      } catch (err) {
        app.log.warn({ err, raw }, "unparseable check_in notification");
      }
    })
    .then(() => undefined);
  return listening;
}

function subscribe(legId: string, fn: Listener): () => void {
  const subs = byLeg.get(legId) ?? new Set<Listener>();
  subs.add(fn);
  byLeg.set(legId, subs);
  return () => {
    subs.delete(fn);
    if (subs.size === 0) byLeg.delete(legId);
  };
}

/** Test seam: how many browsers are currently watching a leg. */
export function watcherCount(legId: string): number {
  return byLeg.get(legId)?.size ?? 0;
}

// --------------------------------------------------------------- payloads

const ADMITTING = ["admitted", "partial", "manual", "overflow_admitted", "re_entry"];

/** One line of the feed: who, where, who let them in, and how many. */
async function feedItem(db: Db, id: string) {
  const [row] = await db`
    select
      c.id, c.result, c.admitted_count, c.recorded_at,
      coalesce(i.display_name, 'Unknown pass') as display_name,
      en.name as entrance_name,
      u.full_name as staff_name,
      il.allowance,
      coalesce((
        select sum(c2.admitted_count)::int from check_in_events c2
        where c2.pass_id = c.pass_id and c2.leg_id = c.leg_id
          and c2.result in ${db(ADMITTING)}
      ), 0) as admitted_total
    from check_in_events c
    left join invitations i on i.id = c.invitation_id
    left join invitation_legs il
      on il.invitation_id = c.invitation_id and il.leg_id = c.leg_id
    left join entrances en on en.id = c.entrance_id
    left join users u      on u.id = c.staff_user_id
    where c.id = ${id}`;
  return row ?? null;
}

/** The counters above the feed, recomputed on every arrival. */
async function counters(db: Db, legId: string) {
  const [att] = await db`select * from leg_attendance where leg_id = ${legId}`;
  const [recent] = await db`
    select coalesce(sum(admitted_count), 0)::int as n
    from check_in_events
    where leg_id = ${legId}
      and result in ${db(ADMITTING)}
      and recorded_at > now() - interval '1 hour'`;
  const [refused] = await db`
    select count(*)::int as n from check_in_events
    where leg_id = ${legId} and admitted_count = 0
      and result <> 'reversal'`;
  const [over] = await db`
    select
      count(*)::int as parties,
      coalesce(sum(extra), 0)::int as people
    from (
      select il.invitation_id,
             coalesce(sum(c.admitted_count), 0) - il.allowance as extra
      from invitation_legs il
      join passes p on p.invitation_id = il.invitation_id
      left join check_in_events c
        on c.pass_id = p.id and c.leg_id = il.leg_id
        and c.result in ${db(ADMITTING)}
      where il.leg_id = ${legId}
      group by il.invitation_id, il.allowance
      having coalesce(sum(c.admitted_count), 0) > il.allowance
    ) s`;

  const arrived = Number(att?.arrived_people ?? 0);
  const confirmed = Number(att?.confirmed_people ?? 0);
  return {
    inside: arrived,
    confirmed,
    still_expected: Math.max(0, confirmed - arrived),
    arrivals_last_hour: recent!.n,
    refused: refused!.n,
    overflow_parties: over!.parties,
    overflow_people: over!.people,
    invited_people: Number(att?.invited_people ?? 0),
  };
}

async function gates(db: Db, legId: string) {
  return db`
    select en.id, en.name,
           coalesce(sum(c.admitted_count) filter (
             where c.result in ${db(ADMITTING)}), 0)::int as admitted,
           (select string_agg(distinct u.full_name, ' · ')
            from staff_assignments sa join users u on u.id = sa.user_id
            where sa.entrance_id = en.id) as ushers,
           max(c.recorded_at) as last_seen_at
    from entrances en
    left join check_in_events c on c.entrance_id = en.id
    where en.leg_id = ${legId}
    group by en.id, en.name
    order by admitted desc, en.name`;
}

export async function liveRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  /** A plain snapshot, for the first paint and for clients without SSE. */
  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/live",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const out = await asUser(sqlRw, uid(req), async (db) => {
        const [ok] = await db`select app_manages_leg(${req.params.legId}::uuid) as ok`;
        if (ok?.ok !== true) return null;
        const [c, g, recent] = await Promise.all([
          counters(db, req.params.legId),
          gates(db, req.params.legId),
          db`select id from check_in_events where leg_id = ${req.params.legId}
             order by recorded_at desc limit 20`,
        ]);
        const feed = [];
        for (const r of recent) feed.push(await feedItem(db, r.id));
        return { counters: c, gates: g, feed: feed.filter(Boolean) };
      });
      if (!out) {
        return reply.code(403).send({ code: "forbidden", message: "Not your event." });
      }
      return out;
    },
  );

  app.get<{ Params: { legId: string } }>(
    "/legs/:legId/stream",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = uid(req);
      const { legId } = req.params;

      const allowed = await asUser(sqlRw, userId, async (db) => {
        const [ok] = await db`select app_manages_leg(${legId}::uuid) as ok`;
        return ok?.ok === true;
      });
      if (!allowed) {
        return reply.code(403).send({ code: "forbidden", message: "Not your event." });
      }

      await ensureListening(app);

      // Fastify steps aside; from here the socket is ours.
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Nginx and friends will happily sit on an event stream forever
        // waiting for it to finish.
        "x-accel-buffering": "no",
      });

      let open = true;
      let close = () => {};

      const push = (chunk: string) => {
        if (!open) return;
        try {
          reply.raw.write(chunk);
        } catch {
          // Writing to a socket the client already dropped. Nothing to
          // report — just stop holding the subscription.
          close();
        }
      };
      const write = (event: string, data: unknown) => {
        push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Retry hint: if the gate's wifi drops, come back in two seconds.
      push("retry: 2000\n\n");

      const snapshot = await asUser(sqlRw, userId, async (db) => ({
        counters: await counters(db, legId),
        gates: await gates(db, legId),
      }));
      write("snapshot", snapshot);

      // Each notification needs a database round trip to become a feed
      // line, and three guests can scan in the same second. Without a
      // queue those enrichments race and the feed shows "4 of 4" above
      // "3 of 4" — the arrivals arriving out of order.
      let queue: Promise<void> = Promise.resolve();

      const unsubscribe = subscribe(legId, (n) => {
        queue = queue.then(async () => {
          if (!open) return;
          try {
            const payload = await asUser(sqlRw, userId, async (db) => ({
              item: await feedItem(db, n.id),
              counters: await counters(db, legId),
              gates: await gates(db, legId),
            }));
            // A row the caller cannot see under RLS simply isn't sent.
            if (payload.item) write("check_in", payload);
          } catch (err) {
            app.log.warn({ err }, "could not build a live feed item");
          }
        });
      });

      // Proxies and phones drop idle connections; a comment every 25s is
      // cheaper than a reconnect storm.
      const heartbeat = setInterval(() => {
        if (open) reply.raw.write(`: ping ${Date.now()}\n\n`);
      }, 25_000);

      close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          reply.raw.end();
        } catch {
          // already gone
        }
      };

      // After reply.hijack() the RESPONSE stream is the dependable signal:
      // req.raw's "close" does not reliably fire for a hijacked SSE
      // connection, and a subscription that outlives its browser tab is a
      // leak that grows all through event day.
      reply.raw.on("close", close);
      reply.raw.on("error", close);
      req.raw.on("close", close);
      req.raw.on("aborted", close);
      req.raw.on("error", close);
    },
  );
}
