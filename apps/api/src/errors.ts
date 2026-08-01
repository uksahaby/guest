/**
 * Knowing something broke, without reading the logs.
 *
 * Logging was already structured and redacted, and 500s were already
 * logged. The gap was that a log nobody is watching is not monitoring —
 * on a wedding morning the organiser finds out before we do, and the first
 * anyone hears of it is a phone call.
 *
 * Three parts, in order of how much they matter:
 *
 *   1. Every 500 gets a request id, and the guest sees it. "Something went
 *      wrong (a3f9c2)" turns an unreproducible complaint into one log
 *      search. Nothing else in the response changes — internals never go
 *      out, in any environment.
 *
 *   2. A crash takes the process down on purpose. After an unhandled
 *      rejection or an uncaught exception the process is in a state nobody
 *      reasoned about, and Render restarts it in seconds. A scanner queues
 *      through a restart; it does not queue through a server quietly
 *      answering wrongly.
 *
 *   3. An optional webhook, so someone is told. Deliberately not a
 *      service: no account, no SDK, no vendor. A URL that accepts a POST
 *      is enough, and Slack, Discord and ntfy all are one.
 *
 * What it does not do: traces, breadcrumbs, session replay, release
 * tracking. If this ever needs those, the answer is Sentry, not more of
 * this file.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { env } from "./env.ts";
import { Window } from "./ratelimit.ts";

/** Where an alert goes. Swapped in tests. */
export interface Alerter {
  send(alert: Alert): Promise<void>;
}

export type Alert = {
  kind: "http_500" | "unhandled_rejection" | "uncaught_exception";
  fingerprint: string;
  message: string;
  where?: string;
  requestId?: string;
};

/**
 * Digits that look like a Nigerian phone number, gone.
 *
 * The logger redacts by field name, which cannot help when a number is
 * inside a message — a Postgres unique-violation detail quotes the value
 * that collided, and for us that value is often somebody's phone number.
 * An alert leaves the building to a third-party chat service, so it gets
 * the blunter tool.
 */
export function scrub(text: string): string {
  return text
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[redacted]")
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "[connection string]");
}

/**
 * What makes two errors "the same error".
 *
 * Route rather than URL: `/events/abc/guests` and `/events/def/guests` are
 * one bug, and keeping the ids would defeat the deduplication exactly when
 * it is needed most — an event whose every request fails.
 */
export function fingerprint(err: Error, where?: string): string {
  const frame = (err.stack ?? "")
    .split("\n")
    .find((l) => l.includes("/src/") || l.includes("\\src\\"));
  const site = frame?.trim().replace(/^at\s+/, "").split(" ").pop() ?? "";
  return `${where ?? "-"}|${err.name}|${site}`.slice(0, 200);
}

/**
 * Posts to a URL and gives up quickly.
 *
 * The body carries `text` and `content` because Slack reads one and
 * Discord the other, and anything else generic takes the JSON whole. Two
 * keys is a smaller price than a per-vendor adapter.
 */
export class WebhookAlerter implements Alerter {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    const line =
      `[${env.isDev ? "dev" : "prod"}] ${alert.kind}` +
      (alert.where ? ` at ${alert.where}` : "") +
      `\n${alert.message}` +
      (alert.requestId ? `\nrequest ${alert.requestId}` : "");

    await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line, content: line, ...alert }),
      // A slow alerting endpoint must never become our outage.
      signal: AbortSignal.timeout(5_000),
    });
  }
}

/**
 * Rate-limits alerts so a crash loop cannot bury the one that mattered —
 * or turn our incident into somebody else's, given every alert is an
 * outbound request.
 *
 * Two ceilings: a few per distinct fault, and a hard total. Both reuse the
 * limiter the auth routes use, because "too many of these per window" is
 * the same problem and it is already tested.
 */
export class Alerts {
  private readonly perFingerprint = new Window({ limit: 3, windowMs: 15 * 60_000 });
  private readonly overall = new Window({ limit: 20, windowMs: 15 * 60_000 });

  constructor(private readonly out: Alerter | null) {}

  /** Never throws and never awaits the caller's path. */
  fire(alert: Alert): void {
    if (!this.out) return;
    if (!this.perFingerprint.hit(alert.fingerprint).ok) return;
    if (!this.overall.hit("all").ok) return;

    void this.out
      .send({ ...alert, message: scrub(alert.message) })
      .catch(() => {
        // An alert that fails is not an event worth alerting about.
      });
  }
}

export function makeAlerter(): Alerter | null {
  return env.errorWebhookUrl ? new WebhookAlerter(env.errorWebhookUrl) : null;
}

/**
 * Wires the request-level half. Process-level handlers are installed by
 * the entry point only, so a test suite building twenty servers does not
 * install twenty exit handlers.
 */
export function installErrorHandling(
  app: FastifyInstance,
  alerts: Alerts,
): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode ?? 500;

    // Everything the client caused stays as it was: its own code, its own
    // message, no alert. A 400 is not an incident.
    if (status < 500) {
      return reply.code(status).send({
        code: err.code ?? "bad_request",
        message: err.message,
      });
    }

    const where = req.routeOptions?.url ?? req.url;
    req.log.error(
      {
        err,
        reqId: req.id,
        route: where,
        method: req.method,
        fingerprint: fingerprint(err, where),
      },
      "unhandled error",
    );

    alerts.fire({
      kind: "http_500",
      fingerprint: fingerprint(err, where),
      message: `${err.name}: ${err.message}`,
      where: `${req.method} ${where}`,
      requestId: String(req.id),
    });

    // The id is the whole point of showing anything: it is what someone
    // reads down the phone. The cause never leaves the server.
    return reply.code(500).send({
      code: "internal_error",
      message: "Something went wrong on our side.",
      request_id: String(req.id),
    });
  });
}

/**
 * Crash loudly, then die.
 *
 * Staying up after an unhandled rejection means serving a wedding from a
 * process whose state nobody can describe. Render restarts in seconds and
 * the scanner queues through it; there is no equivalent recovery from
 * quietly wrong answers.
 */
export function crashHandler(
  app: FastifyInstance,
  alerts: Alerts,
  exit: (code: number) => void = process.exit,
): (kind: Alert["kind"]) => (reason: unknown) => void {
  return (kind) => (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    app.log.fatal({ err, kind }, kind);
    alerts.fire({
      kind,
      fingerprint: fingerprint(err),
      message: `${err.name}: ${err.message}`,
    });
    // Long enough for the log to flush and the alert to leave. Not long
    // enough for the platform's own timeout to decide for us.
    globalThis.setTimeout(() => exit(1), 1_000).unref?.();
  };
}

export function installProcessHandlers(
  app: FastifyInstance,
  alerts: Alerts,
  exit: (code: number) => void = process.exit,
): void {
  // Separated from crashHandler so the behaviour can be tested without
  // emitting the real events — node:test listens for them itself and
  // fails the test before any assertion runs.
  const die = crashHandler(app, alerts, exit);
  process.on("unhandledRejection", die("unhandled_rejection"));
  process.on("uncaughtException", die("uncaught_exception"));
}
