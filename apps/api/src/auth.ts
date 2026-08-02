import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { asAnon, asUser, sqlRw } from "./db.ts";
import { env } from "./env.ts";
import type { SmsSender } from "./sms.ts";
import {
  hashInviteToken,
  hashPassword,
  hashRecoveryCode,
  newRecoveryCode,
  normaliseRecoveryCode,
  passwordProblem,
  verifyPassword,
} from "./credentials.ts";
import { tooMany } from "./ratelimit.ts";

/**
 * Three ways in, all keyed on the phone number (architecture decision #7:
 * phone is the primary identifier, email optional everywhere).
 *
 *   OTP        — anyone. Needs a funded SMS account to work in production.
 *   Invite link — ushers. The organiser shares it over WhatsApp; tapping it
 *                is the whole sign-in. No SMS, no password, nothing for
 *                one-day staff to manage or forget.
 *   Password   — organisers who set one. Optional, never issued by anyone
 *                else, and OTP stays the way back in when it is forgotten.
 *
 * Ushers still have no password, which is the part of decision #7 that
 * mattered. What changed is that they no longer need an SMS either.
 *
 * These routes run through asAnon: the login path has no user context yet,
 * so users and auth_otp_codes are the two tables deliberately left out of
 * RLS and reachable only by app_rw (see db/migrations/003_rls.sql).
 *
 * SMS delivery is behind SmsSender (sms.ts) — Termii in production, a
 * LogSender in dev. dev_code comes back in the response only while the
 * sender is one that does not really deliver; the moment a real provider
 * is configured a code can never leave the server over HTTP.
 *
 * Every door here is open to the internet, so every door here is throttled.
 * The policy and the reasoning behind the numbers live in ratelimit.ts;
 * what matters at the call sites is which key each route counts against
 * and whether it counts requests or only failures.
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

    // Per phone this is already 30 seconds apart. That does nothing about
    // one caller walking a list of numbers, and with Termii configured
    // every one of those is money out of the organiser's account.
    const burst = app.limits.otpRequestPerIp.hit(req.ip);
    if (!burst.ok) {
      return tooMany(reply, burst, "Too many codes requested. Try again later.");
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

  /**
   * POST /auth/signup — create an organiser account, no SMS involved.
   *
   * The phone number is therefore unverified, and that is a real trade
   * rather than an oversight. What makes it tolerable here is that a phone
   * number on its own grants nothing: an usher reaches a gate by holding
   * an invite link, and an organiser owns only the events they create. A
   * squatted number is a nuisance, not a way into someone else's wedding.
   *
   * What it must never do is take over an account that already exists —
   * an usher's record is created by their organiser and has no password,
   * so letting signup set one would hand that gate to whoever asked first.
   * An existing phone is refused outright.
   */
  app.post<{ Body: { phone?: string; password?: string; full_name?: string } }>(
    "/auth/signup",
    async (req, reply) => {
      const phone = normalisePhone(req.body?.phone);
      if (!phone) {
        return reply.code(400).send({
          code: "bad_phone",
          message: "Phone must be E.164, like +2348034112098.",
        });
      }
      const problem = passwordProblem(req.body?.password);
      if (problem) {
        return reply.code(400).send({ code: "bad_password", message: problem });
      }
      // Ahead of the password hash: hashing is deliberately slow, which
      // makes an unthrottled signup endpoint a way to spend the server's
      // CPU as well as a way to fill the users table.
      const burst = app.limits.signupPerIp.hit(req.ip);
      if (!burst.ok) {
        return tooMany(reply, burst, "Too many accounts created from here. Try again later.");
      }

      const fullName = (req.body?.full_name ?? "").trim();
      if (!fullName || fullName.length > 120) {
        return reply.code(400).send({
          code: "bad_name",
          message: "A name is required — it appears on your events.",
        });
      }

      const hash = await hashPassword(req.body!.password!);
      // With no SMS and no email, this is the only self-service way back
      // in. Shown once, here, and never readable again.
      const recoveryCode = newRecoveryCode();

      const created = await asAnon(async (db) => {
        const [row] = await db`
          insert into users
            (phone, full_name, password_hash, recovery_code_hash, last_seen_at)
          values (
            ${phone}, ${fullName}, ${hash},
            ${hashRecoveryCode(recoveryCode)}, now()
          )
          on conflict (phone) do nothing
          returning id, full_name, phone, email`;
        return row ?? null;
      });

      if (!created) {
        return reply.code(409).send({
          code: "phone_taken",
          message:
            "That number already has an account. Sign in instead, or ask whoever added you for your link.",
        });
      }

      return reply.code(201).send({
        access_token: app.jwt.sign({ sub: created.id }, { expiresIn: ACCESS_TTL_S }),
        refresh_token: app.jwt.sign(
          { sub: created.id, typ: "refresh" },
          { expiresIn: 90 * 24 * 3600 },
        ),
        expires_in: ACCESS_TTL_S,
        user: created,
        recovery_code: recoveryCode,
      });
    },
  );

  /**
   * POST /public/staff-invites/:token/accept — an usher's whole sign-in.
   *
   * No SMS, no password. The organiser sent this link over WhatsApp to one
   * phone number; tapping it is the proof, exactly as a guest pass link is
   * proof for a guest. Single use, so a forwarded link is spent.
   */
  app.post<{ Params: { token: string } }>(
    "/public/staff-invites/:token/accept",
    async (req, reply) => {
      const raw = req.params.token ?? "";
      const dead = {
        code: "invite_invalid",
        message: "This link has expired or has already been used. Ask the organiser for a new one.",
      };
      // Garbage, expired, spent and forged all read the same, so the link
      // cannot be probed for which staff exist.
      if (raw.length < 20) return reply.code(404).send(dead);

      const burst = app.limits.inviteAcceptPerIp.hit(req.ip);
      if (!burst.ok) {
        return tooMany(reply, burst, "Too many attempts. Try again later.");
      }

      const session = await asAnon(async (db) => {
        const [invite] = await db`
          select id, user_id, leg_id from staff_invites
          where token_hash = ${hashInviteToken(raw)}
            and accepted_at is null and expires_at > now()`;
        if (!invite) return null;

        // Spend it, and only then hand out a session.
        await db`update staff_invites set accepted_at = now() where id = ${invite.id}`;
        await db`update users set last_seen_at = now() where id = ${invite.user_id}`;

        const [user] = await db`
          select id, full_name, phone, email from users where id = ${invite.user_id}`;
        return user ? { user, legId: invite.leg_id } : null;
      });

      if (!session) return reply.code(404).send(dead);

      return {
        access_token: app.jwt.sign({ sub: session.user.id }, { expiresIn: ACCESS_TTL_S }),
        refresh_token: app.jwt.sign(
          { sub: session.user.id, typ: "refresh" },
          { expiresIn: 90 * 24 * 3600 },
        ),
        expires_in: ACCESS_TTL_S,
        user: session.user,
        // So the web can drop them straight on the gate they were invited to.
        leg_id: session.legId,
      };
    },
  );

  /**
   * POST /auth/password — set or change your own password.
   *
   * Only ever your own: an organiser choosing a password for someone else
   * means the organiser knows their credential, which is the thing the
   * invite links exist to avoid.
   */
  app.post<{ Body: { password?: string } }>(
    "/auth/password",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const problem = passwordProblem(req.body?.password);
      if (problem) {
        return reply.code(400).send({ code: "bad_password", message: problem });
      }
      const userId = (req.user as { sub: string }).sub;
      const hash = await hashPassword(req.body!.password!);
      await asUser(sqlRw, userId, async (db) => {
        await db`update users set password_hash = ${hash} where id = ${userId}`;
      });
      // Send AFTER the transaction, never inside it (STATE.md §5). Replying
      // in the callback answers before the COMMIT, and a login arriving in
      // that window is still accepted on the old password — which a flaky
      // test caught doing exactly that.
      return reply.code(204).send();
    },
  );

  /**
   * POST /auth/recovery-code — mint a fresh one and show it once.
   *
   * For an organiser who never wrote theirs down, or who has just used it.
   * Replacing the old one is the point: two live codes would be two live
   * keys to the same account.
   */
  app.post(
    "/auth/recovery-code",
    { preHandler: [app.authenticate] },
    async (req) => {
      const userId = (req.user as { sub: string }).sub;
      const code = newRecoveryCode();
      return asUser(sqlRw, userId, async (db) => {
        await db`
          update users set recovery_code_hash = ${hashRecoveryCode(code)}
          where id = ${userId}`;
        return { recovery_code: code };
      });
    },
  );

  /**
   * POST /auth/recovery/reset — phone plus recovery code, set a new
   * password, and come back signed in.
   *
   * This is the whole self-service recovery story now that SMS is off. The
   * code is spent and replaced in the same breath, so a screenshot of the
   * old one is worthless afterwards, and the caller is told the new one.
   */
  app.post<{
    Body: { phone?: string; recovery_code?: string; password?: string };
  }>("/auth/recovery/reset", async (req, reply) => {
    const phone = normalisePhone(req.body?.phone);
    const code = normaliseRecoveryCode(req.body?.recovery_code);
    const wrong = {
      code: "recovery_invalid",
      message: "That number and recovery code don't match.",
    };

    const problem = passwordProblem(req.body?.password);
    if (problem) {
      return reply.code(400).send({ code: "bad_password", message: problem });
    }
    if (!phone || code.length < 8) return reply.code(401).send(wrong);

    // The tightest limit in the file. A recovery code is the entire
    // account with nothing behind it, and unlike a password there is no
    // second door to fall back to.
    //
    // 429 rather than 401 tells an attacker their guessing is being
    // counted, which is the honest trade: the alternative is letting a
    // legitimate organiser burn their five attempts in silence and reach
    // the reset-password script wondering why the code they wrote down
    // "stopped working".
    const ipBurst = app.limits.recoveryPerIp.peek(req.ip);
    if (!ipBurst.ok) return tooMany(reply, ipBurst, "Too many attempts. Try again later.");
    const phoneBurst = app.limits.recoveryFailPerPhone.peek(phone);
    if (!phoneBurst.ok) {
      return tooMany(
        reply,
        phoneBurst,
        "Too many recovery attempts for this number. Try again later.",
      );
    }

    const nextCode = newRecoveryCode();
    const hash = await hashPassword(req.body!.password!);

    const user = await asAnon(async (db) => {
      // Matching on the hash means a wrong code never even names an
      // account, so this cannot be used to discover which numbers exist.
      const [row] = await db`
        select id, full_name, phone, email from users
        where phone = ${phone} and recovery_code_hash = ${hashRecoveryCode(code)}`;
      if (!row) return null;

      await db`
        update users set
          password_hash = ${hash},
          recovery_code_hash = ${hashRecoveryCode(nextCode)},
          last_seen_at = now()
        where id = ${row.id}`;
      return row;
    });

    if (!user) {
      app.limits.recoveryPerIp.bump(req.ip);
      app.limits.recoveryFailPerPhone.bump(phone);
      return reply.code(401).send(wrong);
    }
    // Spent successfully: the code is already replaced, so whatever was
    // being guessed at is gone anyway.
    app.limits.recoveryFailPerPhone.forget(phone);

    return {
      access_token: app.jwt.sign({ sub: user.id }, { expiresIn: ACCESS_TTL_S }),
      refresh_token: app.jwt.sign(
        { sub: user.id, typ: "refresh" },
        { expiresIn: 90 * 24 * 3600 },
      ),
      expires_in: ACCESS_TTL_S,
      user,
      // The old one is gone; this replaces it.
      recovery_code: nextCode,
    };
  });

  /**
   * POST /auth/password/login — phone and password, for organisers who set
   * one. OTP still works and is the way back in when a password is
   * forgotten, which is why this never became the only door.
   */
  app.post<{ Body: { phone?: string; password?: string } }>(
    "/auth/password/login",
    async (req, reply) => {
      const phone = normalisePhone(req.body?.phone);
      const password = req.body?.password;
      const wrong = {
        code: "invalid_login",
        message: "That phone number and password don't match.",
      };
      if (!phone || typeof password !== "string" || password.length === 0) {
        return reply.code(401).send(wrong);
      }

      // Checked before the hash below, which is slow by design: without a
      // limit here, a login endpoint is both a password oracle and a way
      // to pin the CPU with a few concurrent requests.
      const ipBurst = app.limits.loginPerIp.peek(req.ip);
      if (!ipBurst.ok) return tooMany(reply, ipBurst, "Too many attempts. Try again later.");
      const phoneBurst = app.limits.loginFailPerPhone.peek(phone);
      if (!phoneBurst.ok) {
        return tooMany(
          reply,
          phoneBurst,
          "Too many failed sign-ins for this number. Try again later, or sign in with a code.",
        );
      }

      const user = await asAnon(async (db) => {
        const [row] = await db`
          select id, full_name, phone, email, password_hash
          from users where phone = ${phone}`;
        // Hash even when there is no such user, so the response time does
        // not say which numbers have accounts.
        const ok = await verifyPassword(password, row?.password_hash ?? null);
        if (!ok || !row) return null;
        await db`update users set last_seen_at = now() where id = ${row.id}`;
        return row;
      });

      if (!user) {
        app.limits.loginPerIp.bump(req.ip);
        app.limits.loginFailPerPhone.bump(phone);
        return reply.code(401).send(wrong);
      }
      // Signing in successfully is the proof that this was never an
      // attack. An organiser who fumbles their password four times on
      // event morning and then gets it right starts clean.
      app.limits.loginFailPerPhone.forget(phone);

      return {
        access_token: app.jwt.sign({ sub: user.id }, { expiresIn: ACCESS_TTL_S }),
        refresh_token: app.jwt.sign(
          { sub: user.id, typ: "refresh" },
          { expiresIn: 90 * 24 * 3600 },
        ),
        expires_in: ACCESS_TTL_S,
        user: {
          id: user.id,
          full_name: user.full_name,
          phone: user.phone,
          email: user.email,
        },
      };
    },
  );

  app.post<{ Body: { phone?: string; code?: string } }>("/auth/otp/verify", async (req, reply) => {
    const phone = normalisePhone(req.body?.phone);
    const code = req.body?.code;
    if (!phone || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return reply.code(401).send({ code: "invalid_code", message: "That code didn't work." });
    }

    // A single code dies after 5 wrong attempts (MAX_ATTEMPTS), but the
    // caller can keep requesting fresh ones. This caps the whole game
    // rather than each round of it.
    const burst = app.limits.otpVerifyPerIp.hit(req.ip);
    if (!burst.ok) {
      return tooMany(reply, burst, "Too many attempts. Try again later.");
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
      // avatar is not sent here — it is bytes, and a JSON body is the
      // wrong place for them. Callers ask GET /me/avatar for the image and
      // use this flag to decide whether to bother.
      const [user] = await db`
        select id, full_name, phone, email,
               (avatar is not null) as has_avatar
        from users where id = ${userId}`;
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
