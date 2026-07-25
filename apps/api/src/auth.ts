import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { asAnon, asUser, sqlRw } from "./db.ts";
import { env } from "./env.ts";

/**
 * Phone-first OTP auth (architecture decision #7: phone is the primary
 * identifier, email optional everywhere; ushers are OTP-only and never
 * have a password).
 *
 * These routes run through asAnon: the login path has no user context yet,
 * so users and auth_otp_codes are the two tables deliberately left out of
 * RLS and reachable only by app_rw (see db/migrations/003_rls.sql).
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

    const outcome = await asAnon(async (db) => {
      const [last] = await db`
        select created_at from auth_otp_codes
        where phone = ${phone} order by created_at desc limit 1`;
      if (last) {
        const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
        if (elapsed < RESEND_SECONDS) {
          return { retryIn: Math.ceil(RESEND_SECONDS - elapsed) };
        }
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      // A new code invalidates outstanding ones — only the latest verifies.
      await db`
        update auth_otp_codes set consumed_at = now()
        where phone = ${phone} and consumed_at is null`;
      await db`
        insert into auth_otp_codes (phone, code_hash, expires_at)
        values (${phone}, ${hashCode(phone, code)}, ${new Date(Date.now() + CODE_TTL_MS)})`;
      return { code };
    });

    if ("retryIn" in outcome) {
      return reply.code(429).send({
        code: "rate_limited",
        message: "A code was just sent.",
        retry_after_seconds: outcome.retryIn,
      });
    }

    await sendSms(app, phone, outcome.code);

    return reply.code(202).send({
      retry_after_seconds: RESEND_SECONDS,
      ...(env.isDev ? { dev_code: outcome.code } : {}),
    });
  });

  app.post<{ Body: { phone?: string; code?: string } }>("/auth/otp/verify", async (req, reply) => {
    const phone = normalisePhone(req.body?.phone);
    const code = req.body?.code;
    if (!phone || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return reply.code(401).send({ code: "invalid_code", message: "That code didn't work." });
    }

    const user = await asAnon(async (db) => {
      const [row] = await db`
        select id, code_hash, attempts from auth_otp_codes
        where phone = ${phone} and consumed_at is null and expires_at > now()
        order by created_at desc limit 1`;
      if (!row || row.attempts >= MAX_ATTEMPTS) return null;

      const expected = Buffer.from(row.code_hash, "hex");
      const given = Buffer.from(hashCode(phone, code), "hex");
      if (!timingSafeEqual(expected, given)) {
        await db`update auth_otp_codes set attempts = attempts + 1 where id = ${row.id}`;
        return null;
      }

      await db`update auth_otp_codes set consumed_at = now() where id = ${row.id}`;

      // Find or create. Name arrives later in onboarding; the empty string
      // satisfies NOT NULL without inventing a fake name.
      const [u] = await db`
        insert into users (phone, full_name, last_seen_at)
        values (${phone}, '', now())
        on conflict (phone) do update set last_seen_at = now()
        returning id, full_name, phone, email`;
      return u ?? null;
    });

    if (!user) {
      return reply.code(401).send({ code: "invalid_code", message: "That code didn't work." });
    }

    return {
      access_token: app.jwt.sign({ sub: user.id }, { expiresIn: ACCESS_TTL_S }),
      refresh_token: app.jwt.sign({ sub: user.id, typ: "refresh" }, { expiresIn: 90 * 24 * 3600 }),
      expires_in: ACCESS_TTL_S,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
      },
    };
  });

  app.get("/me", { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as { sub: string }).sub;
    return asUser(sqlRw, userId, async (db) => {
      const [user] = await db`
        select id, full_name, phone, email from users where id = ${userId}`;
      // RLS narrows this to workspaces the caller owns or belongs to; the
      // where clause is belt to the policy's braces.
      const workspaces = await db`
        select w.id, w.name, w.is_implicit,
               case when w.owner_user_id = ${userId} then 'owner' else m.role::text end as role
        from workspaces w
        left join workspace_memberships m
          on m.workspace_id = w.id and m.user_id = ${userId}
        where w.owner_user_id = ${userId} or m.user_id = ${userId}
        order by w.created_at`;
      return { user, workspaces };
    });
  });
}
