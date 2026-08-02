import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";

/**
 * Profile photos and event covers.
 *
 * Stored as bytes in Postgres and served from here. No object storage, no
 * fourth vendor, no bucket one careless ACL away from listing every photo
 * an organiser uploaded. These are small and few — one per organiser, one
 * per event.
 *
 * Uploads are validated by looking at the bytes, not by trusting the
 * content-type header or the filename. A browser will happily send
 * image/png for a file that is nothing of the sort, and "we only accept
 * images" enforced by a header a caller controls is not a rule.
 */

const uid = (req: FastifyRequest) => (req.user as { sub: string }).sub;

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Magic numbers for the three formats a phone camera or a laptop will
 * produce. Anything else is refused rather than stored and served back to
 * browsers later — an SVG here would be a stored cross-site scripting hole
 * with a friendly filename.
 */
function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function readUpload(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const file = await (req as unknown as {
    file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined>;
  }).file();

  if (!file) {
    reply.code(400).send({ code: "no_file", message: "Choose an image first." });
    return null;
  }

  const bytes = await file.toBuffer();
  if (bytes.length === 0) {
    reply.code(400).send({ code: "no_file", message: "That file was empty." });
    return null;
  }
  if (bytes.length > MAX_BYTES) {
    reply.code(413).send({
      code: "too_large",
      message: "Images must be under 2 MB.",
    });
    return null;
  }

  const mime = sniff(bytes);
  if (!mime) {
    reply.code(415).send({
      code: "not_an_image",
      message: "That is not a JPEG, PNG or WebP image.",
    });
    return null;
  }
  return { bytes, mime };
}

/** Bytes out, with the caching an image deserves and no more. */
function sendImage(
  reply: FastifyReply,
  bytes: Buffer | null,
  mime: string | null,
) {
  if (!bytes) return reply.code(404).send({ code: "no_image" });
  return reply
    .header("content-type", mime ?? "application/octet-stream")
    // Private: an avatar is not secret, but it is not a thing to leave in
    // a shared proxy either. must-revalidate so a new photo appears at
    // once rather than after an hour of someone wondering why it did not.
    .header("cache-control", "private, max-age=0, must-revalidate")
    .send(bytes);
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  // ---- the organiser's own photo -----------------------------------------

  app.post(
    "/me/avatar",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const up = await readUpload(req, reply);
      if (!up) return reply;

      await asUser(sqlRw, uid(req), async (db: Db) => {
        await db`
          update users set avatar = ${up.bytes}, avatar_mime = ${up.mime}
          where id = ${uid(req)}`;
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    "/me/avatar",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      await asUser(sqlRw, uid(req), async (db: Db) => {
        await db`
          update users set avatar = null, avatar_mime = null
          where id = ${uid(req)}`;
      });
      return reply.code(204).send();
    },
  );

  app.get(
    "/me/avatar",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const [row] = await db`
          select avatar, avatar_mime from users where id = ${uid(req)}`;
        return sendImage(reply, row?.avatar ?? null, row?.avatar_mime ?? null);
      }),
  );

  // ---- the event's cover --------------------------------------------------

  app.post<{ Params: { eventId: string } }>(
    "/events/:eventId/cover",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const up = await readUpload(req, reply);
      if (!up) return reply;

      const ok = await asUser(sqlRw, uid(req), async (db: Db) => {
        // RLS decides whether this event is theirs; the update simply
        // affects no rows if it is not.
        const rows = await db`
          update events set cover = ${up.bytes}, cover_mime = ${up.mime}
          where id = ${req.params.eventId} returning id`;
        return rows.length > 0;
      });

      if (!ok) return reply.code(404).send({ code: "not_found" });
      return reply.code(204).send();
    },
  );

  /**
   * The organiser's own view of it.
   *
   * There is deliberately no unauthenticated /events/:id/cover. The first
   * attempt had one, and it 404d against real RLS: app_public may only
   * read an event through a verified pass (policy ev_public), so a bare
   * query correctly sees nothing. That refusal was right — an open route
   * keyed on the event id would let anyone walk ids and collect couples'
   * photographs. Guests reach the cover through their own pass instead,
   * in public.ts.
   */
  app.get<{ Params: { eventId: string } }>(
    "/events/:eventId/cover",
    { preHandler: [app.authenticate] },
    async (req, reply) =>
      asUser(sqlRw, uid(req), async (db: Db) => {
        const [row] = await db`
          select cover, cover_mime from events where id = ${req.params.eventId}`;
        return sendImage(reply, row?.cover ?? null, row?.cover_mime ?? null);
      }),
  );
}
