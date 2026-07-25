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

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function buildServer() {
  const app = Fastify({ logger: env.isDev && process.env.NODE_TEST_CONTEXT === undefined });

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
