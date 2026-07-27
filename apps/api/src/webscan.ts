import type { FastifyInstance } from "fastify";
import { asUser, sqlUsher, type Db } from "./db.ts";
import { decide, type Decision, type LocalInvitation } from "checkin-core";
import { verifyToken, type EventKey } from "checkin-core/token";

/**
 * POST /scanner/legs/:legId/scan — the gate, decided on the server.
 *
 * The Flutter app decides locally and syncs afterwards, because a phone at
 * a Nigerian venue cannot assume signal. A browser cannot do that: it has
 * no offline store, and — the binding constraint — **decide() exists at
 * most twice** (HANDOFF §5). A third implementation in browser JavaScript
 * is the one thing this feature must not become. So the browser stays a
 * dumb terminal: it reads a QR, posts the raw string here, and renders
 * whatever this returns.
 *
 * That makes the web scanner online-only, which is the honest trade. It
 * exists for the casual usher who turns up on the day having installed
 * nothing (HANDOFF calls it "two days that saves an event"), not as a
 * replacement for the app at a gate with no coverage.
 *
 * Everything else matches the sync endpoint: refusals are logged, the
 * needs_count prompt is not, and nothing is ever rejected for policy.
 */

/** Outcomes that move the count; mirrors ADMITTING in checkins.ts. */
const ADMITTING = new Set(["admitted", "partial", "manual", "overflow_admitted"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = {
  /** A scanned QR. Mutually exclusive with pass_id. */
  raw?: string;
  /** Check-in by hand, after finding someone by name. */
  pass_id?: string;
  client_uuid?: string;
  requested_count?: number;
  entrance_id?: string | null;
};

/**
 * The pass id a token claims, without trusting it. decide() verifies the
 * signature properly a moment later; this only says which row to load, and
 * a forged id simply finds nothing. Same two-step the Flutter repository
 * uses, for the same reason: ctx.find is synchronous.
 */
function claimedPassId(raw: string): string | null {
  const first = raw.trim().split(".")[0];
  if (!first) return null;
  try {
    const b = Buffer.from(first.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (b.length !== 16) return null;
    const h = b.toString("hex");
    return [
      h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20),
    ].join("-");
  } catch {
    return null;
  }
}

export async function webScanRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  /**
   * GET /scanner/legs/:legId/guests?q= — search by name, for the web
   * scanner's "find them by hand" path.
   *
   * Pointedly NOT the bootstrap endpoint, which the Flutter app uses for
   * the same job. Bootstrap ships every event signing key, and a browser
   * has no business holding one: the server decides here, so the web
   * surface never needs a key and therefore must never be handed one.
   *
   * usher_guest_list already redacts — it carries the last four digits of
   * a phone for matching, never the number.
   */
  app.get<{ Params: { legId: string }; Querystring: { q?: string } }>(
    "/scanner/legs/:legId/guests",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlUsher, uid(req), async (db) => {
        const [assigned] = await db`select app_works_leg(${req.params.legId}::uuid) as ok`;
        if (assigned?.ok !== true) {
          return reply
            .code(403)
            .send({ code: "forbidden", message: "No assignment on this leg." });
        }

        const q = (req.query?.q ?? "").trim().toLowerCase();
        // Same floor as the app: two characters match half a wedding.
        if (q.length < 3) return { guests: [] };

        const guests = await db`
          select pass_id, display_name, category, table_name,
                 allowance, admitted, rsvp
          from usher_guest_list
          where leg_id = ${req.params.legId} and search_terms like ${"%" + q + "%"}
          order by display_name
          limit 20`;
        return { guests };
      }),
  );

  /**
   * POST /scanner/legs/:legId/walk-ins — someone who is not on the list.
   *
   * At a Nigerian wedding this is not an edge case; it is the first hour.
   * The schema has expected it all along (`invitations.is_walk_in`,
   * `staff_assignments.can_walk_in`, `events.allow_walkins`, and RLS
   * policies letting an usher insert exactly these three rows), so this
   * builds the household the same way the organiser would have: an
   * invitation, an entitlement at this leg, and a pass.
   *
   * It becomes a real household on purpose. A walk-in who steps out for a
   * phone call has to be able to come back in, and that only works if
   * there is a pass and an allowance to count against. It also means they
   * land in billable_people, which is the HANDOFF §3 bargain: admit now,
   * flag it, invoice afterwards.
   *
   * Three separate gates, all defaulting closed:
   *   · the event must allow walk-ins
   *   · this usher must hold can_walk_in
   *   · a cancelled event admits nobody
   */
  app.post<{
    Params: { legId: string };
    Body: {
      client_uuid?: string;
      display_name?: string;
      count?: number;
      entrance_id?: string | null;
    };
  }>(
    "/scanner/legs/:legId/walk-ins",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { legId } = req.params;
      const clientUuid = req.body?.client_uuid;
      const displayName = (req.body?.display_name ?? "").trim();
      const count = Number(req.body?.count ?? 1);

      if (typeof clientUuid !== "string" || !UUID_RE.test(clientUuid)) {
        return reply
          .code(400)
          .send({ code: "bad_request", message: "client_uuid must be a uuid." });
      }
      if (!displayName || displayName.length > 200) {
        return reply.code(400).send({
          code: "bad_request",
          message: "A name is required — the organiser has to know who came in.",
        });
      }
      if (!Number.isInteger(count) || count < 1 || count > 50) {
        return reply
          .code(400)
          .send({ code: "bad_request", message: "count must be 1 to 50." });
      }

      return asUser(sqlUsher, uid(req), async (db) => {
        const [assigned] = await db`select app_works_leg(${legId}::uuid) as ok`;
        if (assigned?.ok !== true) {
          return reply
            .code(403)
            .send({ code: "forbidden", message: "No assignment on this leg." });
        }

        const [leg] = await db`
          select l.event_id, e.allow_walkins, e.status
          from event_legs l join events e on e.id = l.event_id
          where l.id = ${legId}`;
        if (!leg) {
          return reply.code(404).send({ code: "not_found", message: "No such leg." });
        }
        if (leg.status === "cancelled") {
          return reply.code(409).send({
            code: "event_cancelled",
            message: "This event was called off. Nobody is being admitted.",
          });
        }
        if (leg.allow_walkins !== true) {
          return reply.code(403).send({
            code: "walkins_not_allowed",
            message: "This event does not admit walk-ins.",
          });
        }

        const [staff] = await db`
          select can_walk_in from staff_assignments
          where leg_id = ${legId} and user_id = ${uid(req)}`;
        if (staff?.can_walk_in !== true) {
          return reply.code(403).send({
            code: "forbidden",
            message: "You cannot add walk-ins. Ask the organiser.",
          });
        }

        // Idempotent on client_uuid: a retry must not invent a second
        // household, so check before building anything.
        const [existing] = await db`
          select id, invitation_id from check_in_events
          where client_uuid = ${clientUuid}`;
        if (existing) {
          return { recorded: existing.id, duplicate: true };
        }

        const [inv] = await db`
          insert into invitations (event_id, display_name, is_walk_in)
          values (${leg.event_id}, ${displayName}, true)
          returning id`;
        await db`
          insert into invitation_legs (invitation_id, leg_id, allowance, rsvp)
          values (${inv!.id}, ${legId}, ${count}, 'attending')`;
        const [pass] = await db`
          insert into passes (invitation_id, event_id)
          values (${inv!.id}, ${leg.event_id})
          returning id`;

        const [row] = await db`
          insert into check_in_events (
            client_uuid, event_id, leg_id, entrance_id, pass_id, invitation_id,
            staff_user_id, device_id, result, admitted_count, occupancy_delta,
            scanned_at, synced_at
          ) values (
            ${clientUuid}, ${leg.event_id}, ${legId},
            ${req.body?.entrance_id ?? null}, ${pass!.id}, ${inv!.id},
            ${uid(req)}, 'web', 'manual'::checkin_result, ${count}, ${count},
            now(), now()
          )
          returning id`;

        return {
          recorded: row!.id,
          duplicate: false,
          invitation_id: inv!.id,
          pass_id: pass!.id,
          display_name: displayName,
          admitted: count,
        };
      });
    },
  );

  app.post<{ Params: { legId: string }; Body: Body }>(
    "/scanner/legs/:legId/scan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { legId } = req.params;
      const raw = typeof req.body?.raw === "string" ? req.body.raw.trim() : "";
      const manualPassId =
        typeof req.body?.pass_id === "string" ? req.body.pass_id.trim() : "";
      const clientUuid = req.body?.client_uuid;

      if (!raw && !manualPassId) {
        return reply
          .code(400)
          .send({ code: "bad_request", message: "raw or pass_id is required." });
      }
      if (manualPassId && !UUID_RE.test(manualPassId)) {
        return reply
          .code(400)
          .send({ code: "bad_request", message: "pass_id must be a uuid." });
      }
      if (typeof clientUuid !== "string" || !UUID_RE.test(clientUuid)) {
        // The browser supplies it so a double-tap or a retried request
        // cannot admit the same household twice.
        return reply
          .code(400)
          .send({ code: "bad_request", message: "client_uuid must be a uuid." });
      }

      return asUser(sqlUsher, uid(req), async (db) => {
        const [assigned] = await db`select app_works_leg(${legId}::uuid) as ok`;
        if (assigned?.ok !== true) {
          return reply
            .code(403)
            .send({ code: "forbidden", message: "No assignment on this leg." });
        }

        const [leg] = await db`
          select l.event_id, e.allow_overflow, e.require_rsvp, e.status
          from event_legs l join events e on e.id = l.event_id
          where l.id = ${legId}`;
        if (!leg) {
          return reply.code(404).send({ code: "not_found", message: "No such leg." });
        }

        const [staff] = await db`
          select can_override from staff_assignments
          where leg_id = ${legId} and user_id = ${uid(req)}`;

        const keyRows = await db`
          select event_id, event_name, token_version, signing_key
          from usher_event_keys`;
        const keys: EventKey[] = keyRows.map((k) => ({
          eventId: k.event_id,
          eventName: k.event_name,
          tokenVersion: k.token_version,
          key: Buffer.from(k.signing_key),
        }));

        // Prefetch the one household this is about, if any.
        let inv: LocalInvitation | undefined;
        const passId = manualPassId || claimedPassId(raw);
        if (passId) {
          const [s] = await db`select * from pass_state(${passId}::uuid, ${legId}::uuid)`;
          if (s) {
            inv = {
              passId,
              invitationId: s.invitation_id,
              eventId: leg.event_id,
              legId,
              displayName: s.display_name,
              category: s.category,
              tableName: s.table_name,
              allowance: s.allowance,
              admitted: s.admitted,
              rsvp: s.rsvp,
              revoked: s.pass_status === "revoked",
            };
          }
        }

        const decision: Decision = decide(
          {
            currentEventId: leg.event_id,
            currentLegId: legId,
            policy: {
              allowOverflow: leg.allow_overflow,
              requireRsvp: leg.require_rsvp,
              eventCancelled: leg.status === "cancelled",
            },
            keys,
            find: (id) => (inv?.passId === id ? inv : undefined),
            canOverrideRsvp: staff?.can_override ?? false,
          },
          manualPassId
            ? { kind: "manual", passId: manualPassId, requestedCount: req.body?.requested_count }
            : { kind: "scan", raw, requestedCount: req.body?.requested_count },
        );

        // needs_count writes nothing — the usher is still being asked how
        // many arrived, and the answer comes back as a second request.
        if (!decision.log) {
          return { decision, recorded: null };
        }

        const admitted = ADMITTING.has(decision.outcome) ? decision.admittedCount : 0;
        const [row] = await db`
          insert into check_in_events (
            client_uuid, event_id, leg_id, entrance_id, pass_id, invitation_id,
            staff_user_id, device_id, result, admitted_count, occupancy_delta,
            scanned_at, synced_at
          ) values (
            ${clientUuid}, ${leg.event_id}, ${legId},
            ${req.body?.entrance_id ?? null},
            ${decision.invitation?.passId ?? null},
            ${decision.invitation?.invitationId ?? null},
            ${uid(req)}, 'web',
            ${decision.outcome}::checkin_result, ${admitted}, ${admitted},
            now(), now()
          )
          on conflict (client_uuid) do nothing
          returning id`;

        if (!row) {
          // Same client_uuid already landed — a retry, not a second guest.
          const [existing] = await db`
            select id from check_in_events where client_uuid = ${clientUuid}`;
          return { decision, recorded: existing?.id ?? null, duplicate: true };
        }

        return { decision, recorded: row.id, duplicate: false };
      });
    },
  );
}
