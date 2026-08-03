// Minimal env loading — no dotenv dependency; parse .env ourselves so the
// file works the same under tsx, tests, and production (where real env
// vars simply win).
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./dotenv.ts";

const here = dirname(fileURLToPath(import.meta.url));

// Shared with scripts/backup.ts, which needs the same file read without
// also inheriting the required() calls below.
loadDotEnv(join(here, "..", ".env"));

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  port: Number(process.env.PORT ?? 3001),
  /**
   * Loopback locally; a container has to accept traffic from outside
   * itself or the platform's health check never gets an answer and the
   * deploy is rolled back with nothing useful in the log.
   */
  host: process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  isDev: process.env.NODE_ENV !== "production",
  /** Where guest pages live — used to build invitation links. */
  webUrl: process.env.WEB_URL ?? "http://localhost:3000",
  /** Unset locally: checkout falls back to an offline stub provider. */
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
  /** Unset locally: OTP codes go to the log instead of a phone. */
  termiiApiKey: process.env.TERMII_API_KEY ?? "",
  /**
   * Where to shout when something breaks. Any URL that accepts a POST —
   * a Slack or Discord incoming webhook, ntfy, your own endpoint.
   *
   * Unset means the only record is the log, which is nobody watching on a
   * Saturday morning. Alerts are rate-limited and scrubbed of anything
   * phone-shaped before they leave; see errors.ts.
   */
  errorWebhookUrl: process.env.ERROR_WEBHOOK_URL ?? "",
  /**
   * Escape hatch for standing infrastructure up before the Termii account
   * exists. Lets the log-only sender run in production, so a staging box
   * can boot and be signed into by reading its log.
   *
   * It does NOT put codes back in the HTTP response — dev_code stays gated
   * on isDev, so a box with this set still never hands a login code to a
   * caller. Anyone who can read the log could already read the database.
   */
  allowSmsLogSender: process.env.ALLOW_SMS_LOG_SENDER === "true",
  /**
   * The sender ID recipients see. "N-Alert" is Termii's own pre-approved
   * DND-capable ID; a branded one has to be registered with them first.
   */
  smsSenderId: process.env.SMS_SENDER_ID ?? "N-Alert",
  /** See TermiiSender — "dnd" or the message may never arrive. */
  smsChannel: process.env.SMS_CHANNEL ?? "dnd",
  /**
   * Who is allowed to tell us the caller's real address.
   *
   * Rate limiting is worthless without this. In production nothing reaches
   * the API directly: the platform's router sits in front of it, and the
   * web app makes every guest-facing call server-side (apps/web never
   * fetches the API from a browser). Left unset, req.ip is therefore the
   * router or the web app for EVERY request — one key, one bucket, and the
   * first burst locks out the entire internet including the couple.
   *
   * Set it and X-Forwarded-For is believed. That header is trivially
   * forged by anything that can reach the API directly, which is the other
   * half of why the per-phone limits in ratelimit.ts carry the real weight
   * and the per-IP ones are only a ceiling.
   *
   *   TRUST_PROXY=true          believe the whole chain (single platform
   *                             router in front, API not otherwise exposed)
   *   TRUST_PROXY=2             believe the last 2 hops
   *   TRUST_PROXY=10.0.0.0/8    believe only these addresses — best, when
   *                             the platform documents its router's range
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};

export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
