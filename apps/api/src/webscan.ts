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
  raw?: string;
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

  app.post<{ Params: { legId: string }; Body: Body }>(
    "/scanner/legs/:legId/scan",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { legId } = req.params;
      const raw = typeof req.body?.raw === "string" ? req.body.raw.trim() : "";
      const clientUuid = req.body?.client_uuid;

      if (!raw) {
        return reply
          .code(400)
          .send({ code: "bad_request", message: "raw is required." });
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

        // Prefetch the one household the token points at, if any.
        let inv: LocalInvitation | undefined;
        const passId = claimedPassId(raw);
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
          {
            kind: "scan",
            raw,
            requestedCount: req.body?.requested_count,
          },
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
