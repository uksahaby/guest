import type { FastifyInstance } from "fastify";
import { asUser, sqlRw, type Db } from "./db.ts";
import {
  groupWarnings,
  parseCsv,
  readHouseholds,
  type Field,
  type Household,
  type Mapping,
} from "./csv.ts";

/**
 * POST /events/:id/invitations/import — a spreadsheet of households.
 *
 * "One row per household. Free on every plan and never blocked by the
 * people limit — the limit applies at send time, not at import."
 * (openapi, and HANDOFF §4.5: the paywall is on sending, not storing.)
 * There is deliberately no plan check anywhere in this file.
 *
 * Two-step by design, matching the mockup: a dry run returns the guessed
 * column mapping, the grouped warnings and the first few rows, and writes
 * nothing. The organiser corrects the mapping and posts again to commit.
 *
 * Synchronous for now. The contract allows an async job because a 5,000-row
 * import wants a queue; at wedding scale (186 rows in the mockup) a request
 * finishes in well under a second, and a status field nobody polls is worse
 * than none.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5_000;
const PREVIEW_ROWS = 5;

/** What to reply with once the transaction has committed. */
type Sendable = { code: number; body: unknown };

const FORBIDDEN = { code: "forbidden", message: "Not your event." };

const FIELDS: Field[] = [
  "display_name", "allowance", "primary_phone",
  "primary_email", "category", "table", "ignore",
];

function parseMapping(raw: string | undefined): Mapping | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const mapping: Mapping = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const index = Number(k);
    if (Number.isInteger(index) && index >= 0 && FIELDS.includes(v as Field)) {
      mapping[index] = v as Field;
    }
  }
  return Object.keys(mapping).length > 0 ? mapping : undefined;
}

export async function importRoutes(app: FastifyInstance) {
  const uid = (req: { user: unknown }) => (req.user as { sub: string }).sub;

  app.post<{ Params: { eventId: string } }>(
    "/events/:eventId/invitations/import",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(415).send({
          code: "expected_multipart",
          message: "Send the file as multipart/form-data.",
        });
      }

      // Fields and file arrive in one pass; the file may come before or
      // after the mapping depending on the client.
      let csvText: string | undefined;
      let filename: string | undefined;
      let mappingRaw: string | undefined;
      let legIdsRaw: string | undefined;
      let dryRun = false;

      for await (const part of req.parts()) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of part.file) {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) {
              return reply.code(413).send({
                code: "file_too_large",
                message: "That file is over 5 MB — a guest list should be far smaller.",
              });
            }
            chunks.push(chunk as Buffer);
          }
          csvText = Buffer.concat(chunks).toString("utf8");
          filename = part.filename;
        } else {
          const value = String(part.value);
          if (part.fieldname === "mapping") mappingRaw = value;
          if (part.fieldname === "leg_ids") legIdsRaw = value;
          if (part.fieldname === "dry_run") dryRun = value === "true" || value === "1";
        }
      }

      if (csvText === undefined) {
        return reply.code(400).send({ code: "no_file", message: "No file was attached." });
      }

      const parsed = readHouseholds(parseCsv(csvText), parseMapping(mappingRaw));
      if (parsed.total_rows > MAX_ROWS) {
        return reply.code(413).send({
          code: "too_many_rows",
          message: `${parsed.total_rows} rows is more than this import handles (${MAX_ROWS}).`,
        });
      }

      // The transaction must COMMIT before the reply goes out — see the
      // note on asUser below. So the handler returns a description of what
      // to send, and sending happens after.
      const outcome = await asUser(sqlRw, uid(req), async (db): Promise<Sendable> => {
        const { eventId } = req.params;
        const [ok] = await db`select app_manages_event(${eventId}::uuid) as ok`;
        if (ok?.ok !== true) return { code: 403, body: FORBIDDEN };

        // Which legs these households are invited to. Default: every leg,
        // which is right for the single-leg events that are the common case.
        const allLegs = await db`
          select id from event_legs where event_id = ${eventId} order by sequence`;
        const wanted = (legIdsRaw ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const legIds = wanted.length
          ? allLegs.filter((l) => wanted.includes(l.id)).map((l) => l.id as string)
          : allLegs.map((l) => l.id as string);

        if (legIds.length === 0) {
          return {
            code: 400,
            body: {
              code: "no_legs",
              message: "None of those legs belong to this event.",
            },
          };
        }

        // Households already on this list, so a second upload of the same
        // file doesn't double the guest list. Matched on phone first (the
        // reliable key), then on name.
        const existing = await db`
          select display_name, primary_phone from invitations
          where event_id = ${eventId}`;
        const existingPhones = new Set(
          existing.map((e) => e.primary_phone).filter(Boolean) as string[],
        );
        const existingNames = new Set(
          existing.map((e) => String(e.display_name).toLowerCase()),
        );

        const fresh: Household[] = [];
        const alreadyThere: Household[] = [];
        for (const h of parsed.households) {
          const dupe = h.primary_phone
            ? existingPhones.has(h.primary_phone)
            : existingNames.has(h.display_name.toLowerCase());
          if (dupe) alreadyThere.push(h);
          else fresh.push(h);
        }

        const summary = {
          file: filename ?? null,
          total_rows: parsed.total_rows,
          headers: parsed.headers,
          mapping: parsed.mapping,
          has_allowance_column: parsed.has_allowance_column,
          would_import: fresh.length,
          already_on_list: alreadyThere.length,
          skipped: parsed.skipped,
          warnings: parsed.warnings,
          warning_summary: groupWarnings([...parsed.warnings, ...parsed.skipped]),
          people: fresh.reduce((n, h) => n + h.allowance, 0),
          legs: legIds,
          preview: parsed.households.slice(0, PREVIEW_ROWS),
        };

        if (dryRun) {
          return { code: 200, body: { ...summary, status: "preview", imported: 0 } };
        }

        const categories = await ensureCategories(db, eventId, fresh);
        const tables = await ensureTables(db, legIds, fresh);

        let imported = 0;
        for (const h of fresh) {
          const [inv] = await db`
            insert into invitations (event_id, display_name, primary_phone,
              primary_email, category_id)
            values (${eventId}, ${h.display_name}, ${h.primary_phone},
              ${h.primary_email}, ${h.category ? categories.get(h.category.toLowerCase()) ?? null : null})
            returning id`;

          for (const legId of legIds) {
            await db`
              insert into invitation_legs (invitation_id, leg_id, allowance, table_id)
              values (${inv!.id}, ${legId}, ${h.allowance},
                ${h.table ? tables.get(`${legId}:${h.table.toLowerCase()}`) ?? null : null})`;
          }

          // A pass exists from the moment the household does (decision #1),
          // so an imported guest who simply turns up is recognised.
          await db`
            insert into passes (invitation_id, event_id) values (${inv!.id}, ${eventId})`;
          imported++;
        }

        return { code: 202, body: { ...summary, status: "done", imported } };
      });

      return reply.code(outcome.code).send(outcome.body);
    },
  );
}

/** Creates any category named in the sheet that the event doesn't have yet. */
async function ensureCategories(
  db: Db,
  eventId: string,
  households: Household[],
): Promise<Map<string, string>> {
  const names = [...new Set(households.map((h) => h.category).filter(Boolean) as string[])];
  const byKey = new Map<string, string>();
  if (names.length === 0) return byKey;

  const rows = await db`
    select id, name from guest_categories where event_id = ${eventId}`;
  for (const r of rows) byKey.set(String(r.name).toLowerCase(), r.id);

  for (const name of names) {
    if (byKey.has(name.toLowerCase())) continue;
    const [created] = await db`
      insert into guest_categories (event_id, name) values (${eventId}, ${name})
      on conflict (event_id, name) do update set name = excluded.name
      returning id`;
    byKey.set(name.toLowerCase(), created!.id);
  }
  return byKey;
}

/**
 * Same for tables. A sheet that already has seating is doing the organiser
 * a favour, so honour it rather than making them redo it in the UI.
 */
async function ensureTables(
  db: Db,
  legIds: string[],
  households: Household[],
): Promise<Map<string, string>> {
  const names = [...new Set(households.map((h) => h.table).filter(Boolean) as string[])];
  const byKey = new Map<string, string>();
  if (names.length === 0) return byKey;

  for (const legId of legIds) {
    const rows = await db`
      select id, name from seating_tables where leg_id = ${legId}`;
    for (const r of rows) byKey.set(`${legId}:${String(r.name).toLowerCase()}`, r.id);

    for (const name of names) {
      const key = `${legId}:${name.toLowerCase()}`;
      if (byKey.has(key)) continue;
      const [created] = await db`
        insert into seating_tables (leg_id, name, capacity)
        values (${legId}, ${name}, 10)
        on conflict (leg_id, name) do update set name = excluded.name
        returning id`;
      byKey.set(key, created!.id);
    }
    // Tables are per leg, so enable the feature where we just made some.
    await db`update event_legs set tables_enabled = true where id = ${legId}`;
  }
  return byKey;
}

