// Migration runner.
//   npx tsx scripts/migrate.ts            apply everything outstanding
//   npx tsx scripts/migrate.ts --status   list applied / outstanding
//   npx tsx scripts/migrate.ts --baseline mark all applied, run nothing
//
// Until now the deploy story was "run this psql loop by hand", which
// re-runs every file every time and keeps no record of what a database has
// actually seen. That is survivable on a laptop and not survivable on a
// server someone else also touches.
//
// Rules this follows:
//   · one transaction per file — a half-applied migration is worse than a
//     failed one, and DDL in Postgres is transactional
//   · a checksum per file, so editing a migration that has already run is
//     an error rather than a silent divergence
//   · runs as the superuser URL: migrations create roles and grants, which
//     no application role may do
//
// --baseline exists for the database that already has every migration
// applied by the old psql loop: it records them without re-running.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlAdmin as sql, closeDb } from "../src/db.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const dir = join(root, "db", "migrations");

type Migration = { name: string; body: string; checksum: string };

function load(): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const body = readFileSync(join(dir, name), "utf8");
      return {
        name,
        body,
        checksum: createHash("sha256").update(body).digest("hex").slice(0, 16),
      };
    });
}

async function ensureTable(): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )`;
}

async function applied(): Promise<Map<string, string>> {
  const rows = await sql<{ name: string; checksum: string }[]>`
    select name, checksum from schema_migrations`;
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

/** Refuses to continue if a migration changed after it ran. */
function checkDrift(files: Migration[], done: Map<string, string>): void {
  const changed = files.filter(
    (f) => done.has(f.name) && done.get(f.name) !== f.checksum,
  );
  if (changed.length > 0) {
    throw new Error(
      `These migrations changed after they were applied:\n` +
        changed.map((c) => `  ${c.name}`).join("\n") +
        `\nWrite a new migration instead — the database has already run the old text.`,
    );
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const files = load();
  await ensureTable();
  const done = await applied();
  checkDrift(files, done);

  const outstanding = files.filter((f) => !done.has(f.name));

  if (mode === "--status") {
    for (const f of files) {
      console.log(`${done.has(f.name) ? "applied " : "pending "} ${f.name}`);
    }
    console.log(`\n${done.size} applied, ${outstanding.length} outstanding.`);
    return;
  }

  if (mode === "--baseline") {
    for (const f of outstanding) {
      await sql`insert into schema_migrations (name, checksum)
        values (${f.name}, ${f.checksum})`;
    }
    console.log(`Baselined ${outstanding.length} migration(s) without running them.`);
    return;
  }

  if (outstanding.length === 0) {
    console.log("Nothing to apply.");
    return;
  }

  for (const f of outstanding) {
    process.stdout.write(`applying ${f.name} ... `);
    // One transaction per file. sql.unsafe runs the whole body, which is
    // what lets a migration hold several statements.
    await sql.begin(async (tx) => {
      await tx.unsafe(f.body);
      await tx`insert into schema_migrations (name, checksum)
        values (${f.name}, ${f.checksum})`;
    });
    console.log("ok");
  }
  console.log(`Applied ${outstanding.length} migration(s).`);
}

try {
  await main();
} catch (err) {
  console.error(`\nMigration failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
