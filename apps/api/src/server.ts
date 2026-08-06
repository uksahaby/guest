import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import { env } from "./env.ts";
import { sqlVerify, assertDbUp } from "./db.ts";
import { verifyToken, type EventKey } from "checkin-core/token";
import { authRoutes } from "./auth.ts";
import { checkinRoutes } from "./checkins.ts";
import { eventRoutes } from "./events.ts";
import { scannerRoutes } from "./scanner.ts";
import { publicRoutes } from "./public.ts";
import { billingRoutes } from "./billing.ts";
import { reportRoutes } from "./reports.ts";
import { importRoutes } from "./import.ts";
import { tableRoutes } from "./tables.ts";
import { liveRoutes } from "./live.ts";
import { settingsRoutes } from "./settings.ts";
import { teamRoutes } from "./team.ts";
import { webScanRoutes } from "./webscan.ts";
import { adminRoutes } from "./admin.ts";
import { dashboardRoutes } from "./dashboard.ts";
import { rsvpRoutes } from "./rsvps.ts";
import { imageRoutes } from "./images.ts";
import { seatingRoutes } from "./seating.ts";
import { passRoutes } from "./passes.ts";
import { gateRoutes } from "./gates.ts";
import multipart from "@fastify/multipart";
import { makeProvider, type PaymentProvider } from "./paystack.ts";
import { makeSender, type SmsSender } from "./sms.ts";
import { createLimits, type Limits } from "./ratelimit.ts";
import {
  Alerts,
  installErrorHandling,
  installProcessHandlers,
  makeAlerter,
  type Alerter,
} from "./errors.ts";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    limits: Limits;
    alerts: Alerts;
  }
}

export function buildServer(
  opts: {
    provider?: PaymentProvider;
    sms?: SmsSender;
    /** Tests pass a fake; production reads ERROR_WEBHOOK_URL. */
    alerter?: Alerter | null;
  } = {},
) {
  // Logging is off only under test. Production is where logs matter most —
  // there is no other way to find out what happened at someone's wedding.
  const app = Fastify({
    // Without this req.ip is whatever spoke to us last — the platform's
    // router, or apps/web, which makes every guest call server-side. Every
    // per-IP limit would then share one bucket. See env.trustProxy.
    trustProxy: env.trustProxy,
    logger: process.env.NODE_TEST_CONTEXT === undefined && {
      level: process.env.LOG_LEVEL ?? "info",
      // Never let a phone number or a login code reach the log sink.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "phone",
          "code",
          "dev_code",
        ],
        censor: "[redacted]",
      },
    },
  });

  // Webhook signatures are HMACs over the EXACT bytes the provider sent.
  // Re-serialising the parsed object changes key order and whitespace and
  // the digest silently stops matching, so keep the raw string around.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as { rawBody?: string }).rawBody = body as string;
      if (body === "") return done(null, undefined);
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.register(jwt, { secret: env.jwtSecret });

  // Per instance, not module state: each test file builds its own server
  // and every injected request arrives from 127.0.0.1, so a shared counter
  // would make one test's traffic another test's lockout.
  app.decorate("limits", createLimits());

  /**
   * Loud on purpose, in the same spirit as the SMS sender line below.
   *
   * A production box with no TRUST_PROXY still starts, still serves, still
   * rate limits — and does it against the address of whatever spoke to us
   * last, which in this architecture is one router or one web server for
   * every request on the box. The limits then behave as a single shared
   * bucket that any one caller can exhaust for everybody. There is no
   * error, no failed request and nothing in the logs to find later; the
   * first sign is a couple who cannot sign in on their wedding morning.
   *
   * A warning rather than a refusal to boot, because false is genuinely
   * correct for an API exposed directly with nothing in front of it. That
   * is a real deployment, just not this one — so this says what it sees
   * and lets a human decide.
   */
  if (!env.isDev && env.trustProxy === false) {
    app.log.warn(
      { hint: "TRUST_PROXY=true, a hop count, or the router's CIDR — DEPLOY.md §6" },
      "TRUST_PROXY is unset in production: every per-IP rate limit will " +
        "share one bucket, because req.ip is the proxy and not the caller",
    );
  }

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ code: "unauthenticated", message: "Missing or invalid token." });
    }
  });

  // Before the routes, so anything they throw lands here rather than in
  // Fastify's default handler.
  app.decorate("alerts", new Alerts(opts.alerter ?? makeAlerter()));
  installErrorHandling(app, app.alerts);

  app.get("/health", async () => {
    await assertDbUp();
    return { ok: true };
  });

  app.register(authRoutes, { sms: opts.sms ?? makeSender() });
  app.register(checkinRoutes);
  app.register(eventRoutes);
  app.register(scannerRoutes);
  app.register(publicRoutes);
  app.register(billingRoutes, { provider: opts.provider ?? makeProvider() });
  app.register(reportRoutes);
  app.register(importRoutes);
  app.register(tableRoutes);
  app.register(liveRoutes);
  app.register(settingsRoutes);
  app.register(teamRoutes);
  app.register(webScanRoutes);
  app.register(adminRoutes);
  app.register(dashboardRoutes);
  app.register(rsvpRoutes);
  app.register(imageRoutes);
  app.register(seatingRoutes);
  app.register(passRoutes);
  app.register(gateRoutes);

  // Smoke route proving the whole vertical slice works: issue-side data in
  // Postgres, verify-side logic from checkin-core. Dev only.
  if (env.isDev) {
    app.post<{ Body: { raw: string; event_id: string } }>(
      "/dev/verify-token",
      async (req) => {
        const rows = await sqlVerify`
          select id, name, token_version, signing_key
          from events where id = ${req.body.event_id}`;
        const keys: EventKey[] = rows.map((r) => ({
          eventId: r.id,
          eventName: r.name,
          tokenVersion: r.token_version,
          key: Buffer.from(r.signing_key),
        }));
        return verifyToken(req.body.raw, keys);
      },
    );
  }

  return app;
}

// Only listen when run directly, so tests can build the server in-process.
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = buildServer();
  // Only here: a test suite that builds twenty servers must not install
  // twenty sets of process handlers.
  installProcessHandlers(app, app.alerts);
  app.listen({ port: env.port, host: env.host }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
