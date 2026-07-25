import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "./db.ts";
import { env } from "./env.ts";

/**
 * Phone-first OTP auth (architecture decision #7: phone is the primary
 * identifier, email optional everywhere; ushers are OTP-only and never
 * have a password).
 *
 * SMS delivery is behind sendSms() — Termii or Africa's Talking in
 * production (better delivery in Nigeria than Twilio, per the stack rec).
 * In dev the code is logged and returned in the response as dev_code.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const ACCESS_TTL_S = 30 * 24 * 3600; // scanners stay signed in through event day
const PHONE_RE = /^\+\d{8,15}$/;

function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.replace(/[\s\-().]/g, "");
  return PHONE_RE.test(p) ? p : null;
}

function hashCode(phone: string, code: string): string {
  return createHash("sha256").update(`${phone}:${code}:${env.jwtSecret}`).digest("hex");
}

async function sendSms(app: FastifyInstance, phone: string, code: string): Promise<void> {
  // TODO(launch): Termii / Africa's Talking integration.
  app.log.info({ phone, code }, "OTP (dev delivery: log only)");
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { phone?: string } }>("/auth/otp/request", async (req, reply) => {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) {
      return reply.code(400).send({ code: "bad_phone", message: "Phone must be E.164, like +2348034112098." });
    }

    const [last] = await sql`
      select created_at from auth_otp_codes
      where phone = ${phone} order by created_at desc limit 1`;
    if (last) {
      const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
      if (elapsed < RESEND_SECONDS) {
        return reply.code(429).send({
          code: "rate_limited",
          message: "A code was just sent.",
          retry_after_seconds: Math.ceil(RESEND_SECONDS - elapsed),
        });
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    // A new code invalidates outstanding ones — only the latest verifies.
    await sql`
      update auth_otp_codes set consumed_at = now()
      where phone = ${phone} and consumed_at is null`;
    await sql`
      insert into auth_otp_codes (phone, code_hash, expires_at)
      values (${phone}, ${hashCode(phone, code)}, ${new Date(Date.now() + CODE_TTL_MS)})`;

    await sendSms(app, phone, code);

    return reply.code(202).send({
      retry_after_seconds: RESEND_SECONDS,
      ...(env.isDev ? { dev_code: code } : {}),
    });
  });

  app.post<{ Body: { phone?: string; code?: string } }>("/auth/otp/verify", async (req, reply) => {
    const phone = normalisePhone(req.body?.phone);
    const code = req.body?.code;
    if (!phone || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return reply.code(401).send({ code: "invalid_code", message: "That code didn't work." });
    }

    const [row] = await sql`
      select id, code_hash, attempts from auth_otp_codes
      where phone = ${phone} and consumed_at is null and expires_at > now()
      order by created_at desc limit 1`;
    if (!row || row.attempts >= MAX_ATTEMPTS) {
      return reply.code(401).send({ code: "invalid_code", message: "That code didn't work." });
    }

    const expected = Buffer.from(row.code_hash, "hex");
    const given = Buffer.from(hashCode(phone, code), "hex");
    if (!timingSafeEqual(expected, given)) {
      await sql`update auth_otp_codes set attempts = attempts + 1 where id = ${row.id}`;
      return reply.code(401).send({ code: "invalid_code", message: "That code didn't work." });
    }

    await sql`update auth_otp_codes set consumed_at = now() where id = ${row.id}`;

    // Find or create the user. Name arrives later in onboarding; the empty
    // string satisfies NOT NULL without inventing a fake name.
    const [user] = await sql`
      insert into users (phone, full_name, last_seen_at)
      values (${phone}, '', now())
      on conflict (phone) do update set last_seen_at = now()
      returning id, full_name, phone, email`;

    const u = user!;
    return {
      access_token: app.jwt.sign({ sub: u.id }, { expiresIn: ACCESS_TTL_S }),
      refresh_token: app.jwt.sign({ sub: u.id, typ: "refresh" }, { expiresIn: 90 * 24 * 3600 }),
      expires_in: ACCESS_TTL_S,
      user: { id: u.id, full_name: u.full_name, phone: u.phone, email: u.email },
    };
  });

  app.get("/me", { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    const [user] = await sql`
      select id, full_name, phone, email from users where id = ${userId}`;
    const workspaces = await sql`
      select w.id, w.name, w.is_implicit,
             case when w.owner_user_id = ${userId} then 'owner' else m.role::text end as role
      from workspaces w
      left join workspace_memberships m
        on m.workspace_id = w.id and m.user_id = ${userId}
      where w.owner_user_id = ${userId} or m.user_id = ${userId}
      order by w.created_at`;
    return { user, workspaces };
  });
}
