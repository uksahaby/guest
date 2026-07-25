import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pass token.
 *
 * Format:  <pass>.<event>.<v>.<sig>
 *
 * UUIDs are packed to 16 raw bytes and base64url'd to 22 characters rather
 * than carried as 36-character hex. The whole token lands around 62 chars,
 * which keeps the QR at a low version — fewer, larger modules, and a much
 * better scan in a dark hall on a cracked screen.
 *
 * The signature is HMAC-SHA256 truncated to 12 bytes. Forging one is 2^96
 * work, and the server re-derives every outcome on sync anyway, so the
 * token only has to be good enough to trust for the few seconds between
 * the scan and the guest walking through.
 *
 * No personal data is in here. A leaked token reveals two opaque ids.
 */

export type EventKey = {
  eventId: string;
  eventName: string;
  tokenVersion: number;
  key: Buffer;
};

export type TokenPayload = {
  passId: string;
  eventId: string;
  tokenVersion: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function packUuid(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`not a uuid: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

function unpackUuid(packed: string): string {
  const b = Buffer.from(packed, "base64url");
  if (b.length !== 16) throw new Error("bad uuid packing");
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
    16,
    20,
  )}-${h.slice(20)}`;
}

function sign(body: string, key: Buffer): string {
  return createHmac("sha256", key).update(body).digest().subarray(0, 12)
    .toString("base64url");
}

export function issueToken(p: TokenPayload, key: Buffer): string {
  const body = `${packUuid(p.passId)}.${packUuid(p.eventId)}.${p.tokenVersion}`;
  return `${body}.${sign(body, key)}`;
}

export type VerifyOk = {
  ok: true;
  payload: TokenPayload;
  /** Which held key verified it — may not be the event being scanned. */
  matched: EventKey;
};
export type VerifyFail = { ok: false; reason: "malformed" | "no_key" | "stale_version" };

/**
 * Tries every key the device holds, not just the current event's.
 *
 * That is deliberate. With one key you cannot tell a forgery from last
 * week's wedding, and the usher gets "invalid" for a guest holding a
 * perfectly genuine pass to a different event. With all of them you can
 * say which event it belongs to, which is the difference between a useful
 * message and a shrug.
 */
export function verifyToken(raw: string, keys: EventKey[]): VerifyOk | VerifyFail {
  const parts = raw.trim().split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };

  // Length checked above; assertion is type-level only.
  const [pass, event, verStr, sig] = parts as [string, string, string, string];
  const body = `${pass}.${event}.${verStr}`;

  let payload: TokenPayload;
  try {
    payload = {
      passId: unpackUuid(pass),
      eventId: unpackUuid(event),
      tokenVersion: Number(verStr),
    };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isInteger(payload.tokenVersion)) {
    return { ok: false, reason: "malformed" };
  }

  const given = Buffer.from(sig, "base64url");
  if (given.length !== 12) return { ok: false, reason: "malformed" };

  for (const k of keys) {
    const expected = Buffer.from(sign(body, k.key), "base64url");
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      // A pass reissue bumps token_version. Old codes stop working without
      // needing every one of them on a revocation list.
      if (payload.tokenVersion !== k.tokenVersion) {
        return { ok: false, reason: "stale_version" };
      }
      return { ok: true, payload, matched: k };
    }
  }
  return { ok: false, reason: "no_key" };
}
