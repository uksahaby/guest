import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env.ts";

/**
 * The two ways in that are not an SMS.
 *
 *   Usher invite links — a one-time URL the organiser shares over WhatsApp.
 *   Same trust model as a guest pass: the link IS the credential, sent to
 *   one phone number. No password to forget and no reset flow, which is
 *   the whole point for staff who work one day and are never seen again.
 *
 *   Organiser passwords — optional, set by the account's owner, never by
 *   anyone else. OTP remains the recovery path, because a password with no
 *   way back in is a support problem waiting to happen.
 *
 * No new dependency: scrypt is in node:crypto and is a real KDF. bcrypt
 * and argon2 are both fine too; the point is that it must not be a plain
 * hash, because a stolen users table would otherwise be a stolen password
 * list.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
) => Promise<Buffer>;

// Deliberately slow. These are the numbers node's own docs suggest for
// interactive logins; raising N is the knob if hardware gets cheaper.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export const MIN_PASSWORD = 10;

/** Stored as N$r$p$salt$hash so the cost can be raised without a migration. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P });
  return [N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(
  plain: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  const [n, r, p, saltB64, keyB64] = parts;
  try {
    const key = await scrypt(plain, Buffer.from(saltB64!, "base64"), KEYLEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    const expected = Buffer.from(keyB64!, "base64");
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * Why a password can be refused. Length is the only rule that reliably
 * helps; composition rules push people towards Passw0rd! and nothing else.
 */
export function passwordProblem(plain: unknown): string | null {
  if (typeof plain !== "string" || plain.trim().length === 0) {
    return "A password is required.";
  }
  if (plain.length < MIN_PASSWORD) {
    return `At least ${MIN_PASSWORD} characters — length is what actually helps.`;
  }
  if (plain.length > 200) return "That password is too long.";
  return null;
}

// ---- invite links ---------------------------------------------------------

/** 32 bytes of randomness, URL-safe. The whole credential. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Peppered with the JWT secret, exactly like the OTP codes: a database
 * read must never yield a working link.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(`${token}:${env.jwtSecret}`).digest("hex");
}

/** Long enough to survive "I'll do it tomorrow", short enough to expire. */
export const INVITE_TTL_DAYS = 14;
