import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { env } from "./env.ts";
import { sql, assertDbUp } from "./db.ts";
import { verifyToken, type EventKey } from "checkin-core/token";

export function buildServer() {
  const app = Fastify({ logger: env.isDev });

  app.register(jwt, { secret: env.jwtSecret });

  app.get("/health", async () => {
    await assertDbUp();
    return { ok: true };
  });

  // Smoke route proving the whole vertical slice works: issue-side data in
  // Postgres, verify-side logic from checkin-core. Dev only; removed when
  // the real /scanner/check-ins endpoint lands.
  if (env.isDev) {
    app.post<{ Body: { raw: string; event_id: string } }>(
      "/dev/verify-token",
      async (req) => {
        const rows = await sql`
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
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const app = buildServer();
  app.listen({ port: env.port, host: "127.0.0.1" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
