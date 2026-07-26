import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { asAnon, asUser, sqlRw } from "./db.ts";
import { env } from "./env.ts";
import type { SmsSender } from "./sms.ts";

/**
 * Phone-first OTP auth (architecture decision #7: phone is the primary
 * identifier, email optional everywhere; ushers are OTP-only and never
 * have a password).
 *
 * These routes run through asAnon: the login path has no user context yet,
 * so users and auth_otp_codes are the two tables deliberately left out of
 * RLS and reachable only by app_rw (see db/migrations/003_rls.sql).
 *
 * SMS delivery is behind SmsSender (sms.ts) — Termii in production, a
 * LogSender in dev. dev_code comes back in the response only while the
 * sender is one that does not really deliver; the moment a real provider
 * is configured a code can never leave the server over HTTP.
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

/**
 * Kept short and boring on purpose: it is read aloud across a noisy hall
 * as often as it is tapped in, and a long message costs a second SMS page.
 */
function codeMessage(code: string): string {
  return `${code} is your sign-in code. It expires in 10 minutes. Do not share it with anyone.`;
}

export async function authRoutes(
  app: FastifyInstance,
  opts: { sms: SmsSender },
) {
  const { sms } = opts;
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
      const [row] = await db`
        insert into auth_otp_codes (phone, code_hash, expires_at)
        values (${phone}, ${hashCode(phone, code)}, ${new Date(Date.now() + CODE_TTL_MS)})
        returning id`;
      return { code, id: row!.id as string };
    });

    if ("retryIn" in outcome) {
      return reply.code(429).send({
        code: "rate_limited",
        message: "A code was just sent.",
        retry_after_seconds: outcome.retryIn,
      });
    }

    try {
      await sms.send({ to: phone, text: codeMessage(outcome.code) });
    } catch (err) {
      // Roll the code back rather than leave it standing. Otherwise the
      // user waits for an SMS that is never coming, and the resend window
      // (which reads the newest row regardless of consumed_at) locks them
      // out of trying again for half a minute over our failure.
      await asAnon((db) => db`delete from auth_otp_codes where id = ${outcome.id}`);
      app.log.error({ err, phone, sender: sms.name }, "OTP delivery failed");
      return reply.code(502).send({
        code: "sms_failed",
        message: "We couldn't send your code. Try again in a moment.",
      });
    }

    return reply.code(202).send({
      retry_after_seconds: RESEND_SECONDS,
      // Gated on the sender, not on isDev: a staging box running with
      // NODE_ENV unset but a real Termii key must not echo codes.
      ...(env.isDev && sms.echoesCodes ? { dev_code: outcome.code } : {}),
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

  // Loud on purpose. "Nobody can sign in" is the failure mode of a deploy
  // that forgot the API key, and it is invisible until a customer reports it.
  app.log.info(
    { sender: sms.name, delivers: !sms.echoesCodes },
    "auth routes ready",
  );

  /**
   * Name yourself. Sign-in is phone-only, so this is the one place a user
   * ever gets a name — nothing in the OTP flow can invent one.
   *
   * Worth doing before the first event: the implicit workspace is created
   * lazily on that first event and takes its name from full_name at that
   * moment (events.ts), so naming yourself first is what stops everyone's
   * workspace being called "My events".
   */
  app.patch<{ Body: { full_name?: string; email?: string } }>(
    "/me",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const userId = (req.user as { sub: string }).sub;

      const rawName = req.body?.full_name;
      const name = typeof rawName === "string" ? rawName.trim() : undefined;
      if (name !== undefined && (name.length === 0 || name.length > 120)) {
        return reply
          .code(400)
          .send({ code: "bad_name", message: "A name is required." });
      }

      const rawEmail = req.body?.email;
      const email = typeof rawEmail === "string" ? rawEmail.trim() : undefined;
      if (email !== undefined && email !== "" && !email.includes("@")) {
        return reply
          .code(400)
          .send({ code: "bad_email", message: "That email doesn't look right." });
      }

      return asUser(sqlRw, userId, async (db) => {
        const [user] = await db`
          update users set
            full_name = coalesce(${name ?? null}, full_name),
            email     = coalesce(${email ?? null}, email)
          where id = ${userId}
          returning id, full_name, phone, email`;
        return { user };
      });
    },
  );

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
