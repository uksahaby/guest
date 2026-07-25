import type { FastifyInstance } from "fastify";
import { sql } from "./db.ts";
import { decide, type LocalInvitation, type Outcome } from "checkin-core";

/**
 * POST /scanner/check-ins — the sync endpoint for queued scans.
 *
 * The rules, from HANDOFF §6 and phase-4c §10:
 *
 *  · Idempotent by client_uuid. A replay returns the stored outcome with
 *    duplicate: true. Without this a flaky connection double-admits.
 *
 *  · The server re-runs decide() against database state. The device is
 *    trusted for WHAT HAPPENED at the gate, never for whether it was
 *    allowed. But a disagreement never rejects the row — the people are
 *    already inside. It records the row and flags it contested.
 *
 *  · Two offline phones admitting the same pass both land. The second is
 *    contested (the server's re-run sees the allowance already spent).
 *    Nobody is retroactively denied.
 *
 *  · Refused attempts (admitted_count 0) are recorded too — the refusal
 *    log is one of the things organisers value most.
 *
 * accepted: false is reserved for structurally bad items: unknown leg or
 * pass, no staff assignment, count/result mismatch, bad reversal target.
 * Policy disagreements are contested, not rejected.
 */

const ADMITTING = new Set(["admitted", "partial", "manual", "overflow_admitted"]);
const REFUSING = new Set([
  "allowance_exhausted", "invalid", "wrong_event", "wrong_leg", "revoked",
  "rsvp_blocked", "rsvp_declined", "overflow_blocked", "not_found",
]);
const SERVER_ADMITS: ReadonlySet<Outcome> = new Set([
  "admitted", "partial", "manual", "overflow_admitted",
]);

const CONTESTED_MARK = "[contested]";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SubmitItem = {
  client_uuid: string;
  leg_id: string;
  entrance_id?: string | null;
  pass_id?: string | null;
  result: string;
  admitted_count?: number;
  reverses_client_uuid?: string | null;
  scanned_at: string;
  device_id?: string;
  note?: string | null;
};

type ItemOutcome = {
  client_uuid: string;
  id: string | null;
  accepted: boolean;
  duplicate: boolean;
  contested: boolean;
  error?: { code: string; message: string };
};

function bad(item: SubmitItem, code: string, message: string): ItemOutcome {
  return {
    client_uuid: item.client_uuid ?? "",
    id: null,
    accepted: false,
    duplicate: false,
    contested: false,
    error: { code, message },
  };
}

export async function checkinRoutes(app: FastifyInstance) {
  app.post("/scanner/check-ins", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = req.body as { items?: unknown } | null;
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
      return reply.code(400).send({
        code: "bad_request",
        message: "Body must be { items: [...] } with 1–500 entries.",
      });
    }

    const staffUserId = (req.user as { sub: string }).sub;
    const results: ItemOutcome[] = [];
    // Sequential on purpose: a reversal may target an earlier item in the
    // same batch, and each item's decide() re-run must see rows the batch
    // already landed.
    for (const raw of items) {
      results.push(await processItem(staffUserId, raw as SubmitItem));
    }
    return { results };
  });
}

async function processItem(staffUserId: string, item: SubmitItem): Promise<ItemOutcome> {
  // ---- shape ------------------------------------------------------------
  if (!UUID_RE.test(item.client_uuid ?? "")) {
    return bad(item, "bad_client_uuid", "client_uuid must be a uuid.");
  }
  if (!UUID_RE.test(item.leg_id ?? "")) {
    return bad(item, "bad_leg_id", "leg_id must be a uuid.");
  }
  const scannedAt = new Date(item.scanned_at ?? "");
  if (Number.isNaN(scannedAt.getTime())) {
    return bad(item, "bad_scanned_at", "scanned_at must be a date-time.");
  }

  const count = item.admitted_count ?? 0;
  const result = item.result;
  if (ADMITTING.has(result)) {
    if (!Number.isInteger(count) || count < 1) {
      return bad(item, "count_mismatch", `${result} requires admitted_count >= 1.`);
    }
    if (!UUID_RE.test(item.pass_id ?? "")) {
      return bad(item, "bad_pass_id", `${result} requires a pass_id.`);
    }
  } else if (REFUSING.has(result)) {
    if (count !== 0) {
      return bad(item, "count_mismatch", "A refusal admits nobody; admitted_count must be 0.");
    }
  } else if (result === "reversal") {
    if (!Number.isInteger(count) || count >= 0) {
      return bad(item, "count_mismatch", "A reversal carries a negative admitted_count.");
    }
    if (!UUID_RE.test(item.reverses_client_uuid ?? "")) {
      return bad(item, "bad_reversal", "reversal requires reverses_client_uuid.");
    }
  } else {
    return bad(item, "unsupported_result", `result '${result}' is not accepted by this endpoint.`);
  }

  // Validated above for the results that require them; narrowed locals so
  // the compiler tracks what the regex checks established.
  let passId: string | null = UUID_RE.test(item.pass_id ?? "") ? item.pass_id! : null;
  const reversesClientUuid: string | null =
    UUID_RE.test(item.reverses_client_uuid ?? "") ? item.reverses_client_uuid! : null;

  // ---- replay? -----------------------------------------------------------
  const existing = await sql`
    select id, note from check_in_events where client_uuid = ${item.client_uuid}`;
  if (existing.length > 0) {
    return {
      client_uuid: item.client_uuid,
      id: existing[0]!.id,
      accepted: true,
      duplicate: true,
      contested: (existing[0]!.note ?? "").startsWith(CONTESTED_MARK),
    };
  }

  // ---- leg, event policy, staff assignment -------------------------------
  const legRows = await sql`
    select l.id as leg_id, l.event_id, e.allow_overflow, e.require_rsvp
    from event_legs l join events e on e.id = l.event_id
    where l.id = ${item.leg_id}`;
  if (legRows.length === 0) return bad(item, "leg_not_found", "No such leg.");
  const leg = legRows[0]!;

  const staffRows = await sql`
    select can_manual, can_walk_in, can_override
    from staff_assignments
    where user_id = ${staffUserId} and leg_id = ${item.leg_id}`;
  if (staffRows.length === 0) {
    return bad(item, "forbidden", "No staff assignment on this leg.");
  }
  const staff = staffRows[0]!;

  // ---- resolve pass → invitation ----------------------------------------
  let invitationId: string | null = null;
  if (passId) {
    const passRows = await sql`
      select invitation_id, event_id from passes where id = ${passId}`;
    if (passRows.length === 0) return bad(item, "pass_not_found", "No such pass.");
    if (passRows[0]!.event_id !== leg.event_id) {
      // A wrong-event refusal legitimately references no local pass; an
      // ADMISSION against another event's pass is device corruption.
      if (ADMITTING.has(result)) {
        return bad(item, "pass_event_mismatch", "Pass belongs to another event.");
      }
    }
    invitationId = passRows[0]!.invitation_id;
  }

  // ---- reversal target ----------------------------------------------------
  let reversesId: string | null = null;
  if (result === "reversal") {
    const orig = await sql`
      select id, pass_id, invitation_id, leg_id, result, admitted_count
      from check_in_events where client_uuid = ${reversesClientUuid}`;
    if (orig.length === 0) {
      return bad(item, "reversal_target_missing", "No check-in with that client_uuid.");
    }
    const o = orig[0]!;
    if (!ADMITTING.has(o.result)) {
      return bad(item, "reversal_target_invalid", "Only admissions can be reversed.");
    }
    if (o.leg_id !== item.leg_id) {
      return bad(item, "reversal_target_invalid", "Reversal must be on the same leg.");
    }
    if (count !== -o.admitted_count) {
      return bad(item, "reversal_count_mismatch",
        `Reversal must undo the full admission (expected ${-o.admitted_count}).`);
    }
    const already = await sql`
      select 1 from check_in_events where reverses_check_in_id = ${o.id}`;
    if (already.length > 0) {
      return bad(item, "already_reversed", "That check-in was already reversed.");
    }
    reversesId = o.id;
    invitationId = o.invitation_id;
    passId = o.pass_id;
  }

  // ---- the server's own opinion (HANDOFF §6: re-run decide()) ------------
  // Only admissions need one — they are the rows that move the count.
  let contested = false;
  let serverNote: string | null = null;

  if (ADMITTING.has(result)) {
    const stateRows = await sql`
      select * from pass_state(${passId}::uuid, ${item.leg_id}::uuid)`;

    let inv: LocalInvitation | undefined;
    if (stateRows.length > 0) {
      const s = stateRows[0]!;
      inv = {
        passId: passId!,
        invitationId: s.invitation_id,
        eventId: leg.event_id,
        legId: item.leg_id,
        displayName: s.display_name,
        category: s.category,
        tableName: s.table_name,
        allowance: s.allowance,
        admitted: s.admitted,
        rsvp: s.rsvp,
        revoked: s.pass_status === "revoked",
      };
    }

    const verdict = decide(
      {
        currentEventId: leg.event_id,
        currentLegId: item.leg_id,
        policy: { allowOverflow: leg.allow_overflow, requireRsvp: leg.require_rsvp },
        keys: [], // manual-kind input skips token checks; no keys needed
        find: () => inv,
        canOverrideRsvp: staff.can_override,
      },
      { kind: "manual", passId: passId!, requestedCount: count },
    );

    const rsvpHold = verdict.outcome === "rsvp_blocked" || verdict.outcome === "rsvp_declined";
    if (!SERVER_ADMITS.has(verdict.outcome) && !(rsvpHold && staff.can_override)) {
      // Server would have refused — the two-offline-phones overlap, a pass
      // revoked mid-event, a household not on this leg. Record anyway,
      // flag it. The people are already inside.
      contested = true;
      serverNote = `${CONTESTED_MARK} server outcome: ${verdict.outcome}`;
    } else if (
      verdict.outcome === "overflow_admitted" &&
      result !== "overflow_admitted"
    ) {
      // Device believed it was within allowance; the reconciled sum says
      // over. The offline-overlap signature.
      contested = true;
      serverNote = `${CONTESTED_MARK} over allowance on reconciliation`;
    }
  }

  // ---- append the row -----------------------------------------------------
  const note = serverNote
    ? item.note ? `${serverNote} · ${item.note}` : serverNote
    : item.note ?? null;

  try {
    const inserted = await sql`
      insert into check_in_events (
        client_uuid, event_id, leg_id, entrance_id, pass_id, invitation_id,
        staff_user_id, device_id, result, admitted_count, occupancy_delta,
        reverses_check_in_id, scanned_at, synced_at, note
      ) values (
        ${item.client_uuid}, ${leg.event_id}, ${item.leg_id},
        ${item.entrance_id ?? null}, ${passId}, ${invitationId},
        ${staffUserId}, ${item.device_id ?? null},
        ${result}::checkin_result, ${count},
        ${REFUSING.has(result) ? 0 : count},
        ${reversesId}, ${scannedAt}, now(), ${note}
      )
      on conflict (client_uuid) do nothing
      returning id`;

    if (inserted.length === 0) {
      // Raced with a concurrent replay of the same client_uuid.
      const row = await sql`
        select id, note from check_in_events where client_uuid = ${item.client_uuid}`;
      return {
        client_uuid: item.client_uuid,
        id: row[0]?.id ?? null,
        accepted: true,
        duplicate: true,
        contested: (row[0]?.note ?? "").startsWith(CONTESTED_MARK),
      };
    }

    return {
      client_uuid: item.client_uuid,
      id: inserted[0]!.id,
      accepted: true,
      duplicate: false,
      contested,
    };
  } catch (err) {
    return bad(item, "invalid_reference",
      err instanceof Error ? err.message : "Insert failed.");
  }
}
