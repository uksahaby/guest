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
import multipart from "@fastify/multipart";
import { makeProvider, type PaymentProvider } from "./paystack.ts";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function buildServer(opts: { provider?: PaymentProvider } = {}) {
  const app = Fastify({ logger: env.isDev && process.env.NODE_TEST_CONTEXT === undefined });

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

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ code: "unauthenticated", message: "Missing or invalid token." });
    }
  });

  app.get("/health", async () => {
    await assertDbUp();
    return { ok: true };
  });

  app.register(authRoutes);
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
  app.listen({ port: env.port, host: "127.0.0.1" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
