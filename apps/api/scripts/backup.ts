// Takes a backup, and proves it is readable before calling it one.
//
//   npm run backup --workspace api                  write a new dump
//   npm run backup --workspace api -- --list FILE   what is inside one
//   npm run backup --workspace api -- --prune 30    delete dumps older than
//
// Why this exists when Neon already has point-in-time restore: PITR only
// helps while the Neon account is reachable and intact. It covers the
// likely accident — a bad migration, a DELETE without a WHERE — and none of
// the unlikely ones: a suspended account, a deleted project, a billing
// lapse. A dump on a disk you control covers those, and nothing else does.
// Both, not either.
//
// The irreplaceable table is check_in_events. Everything else can be
// rebuilt from an organiser's own records — the guest list came from their
// spreadsheet — but who actually walked through the gate exists here and
// nowhere else, and it is append-only precisely because it is evidence.
//
// Custom format (-Fc): compressed, and pg_restore can list it, restore one
// table from it, or reorder for dependencies. A plain .sql file can only be
// replayed whole.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../src/dotenv.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

// The connection string lives in apps/api/.env like everything else. Read
// it, or the documented `npm run backup` fails with "set SUPERUSER_URL" on
// a machine that has one.
loadDotEnv(join(here, "..", ".env"));

const outDir = process.env.BACKUP_DIR ?? join(root, "backups");

/** Superuser: a backup that cannot read every row is not a backup. */
function url(): string {
  const u = process.env.SUPERUSER_URL ?? process.env.DATABASE_URL;
  if (!u) {
    throw new Error(
      "Set SUPERUSER_URL (or DATABASE_URL) to the owner connection string.",
    );
  }
  return u;
}

/** Sortable, and legal on Windows — a colon in a filename is not. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    // The URL carries the password. Keeping it out of argv would be better
    // still, but pg_dump takes it as an argument and this is a local tool.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function take(): void {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `guest-${stamp()}.dump`);

  process.stdout.write("dumping ... ");
  run("pg_dump", [
    url(),
    "--format=custom",
    "--compress=9",
    // Roles live outside the database and are created by migration 003.
    // Dumping ownership here would make the file refuse to restore anywhere
    // the five roles do not already exist, which is every fresh database.
    // The restore procedure in DEPLOY.md creates them first, on purpose.
    "--no-owner",
    "--file",
    file,
  ]);

  const size = statSync(file).size;
  console.log(`ok  ${(size / 1024 / 1024).toFixed(1)} MB`);

  // A dump nobody has opened is a rumour. pg_restore --list parses the
  // whole archive header and table of contents, so a truncated or
  // half-written file fails here rather than during a restore at 2am.
  process.stdout.write("verifying ... ");
  const toc = run("pg_restore", ["--list", file]);
  const tables = toc.split("\n").filter((l) => l.includes("TABLE DATA")).length;
  if (tables === 0) {
    throw new Error(
      `${file} contains no table data. Refusing to call this a backup.`,
    );
  }
  console.log(`ok  ${tables} tables`);

  console.log(`\n${file}`);
  console.log(
    "\nThis file is only a backup once a copy of it is somewhere this\n" +
      "machine is not. A disk that dies takes the database and the backup\n" +
      "with it if they share a housing.",
  );
}

function list(file: string): void {
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const toc = run("pg_restore", ["--list", file]);
  for (const line of toc.split("\n")) {
    if (line.includes("TABLE DATA")) console.log(line.trim());
  }
}

/** Old dumps are not free, and keeping every one forever means nobody
 *  notices when the newest is a month stale. */
function prune(days: number): void {
  if (!existsSync(outDir)) return;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const dumps = readdirSync(outDir)
    .filter((f) => f.endsWith(".dump"))
    .map((f) => ({ f, path: join(outDir, f), at: statSync(join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

  // Never leave zero. A retention rule that can empty the directory is a
  // deletion script wearing a hat.
  const doomed = dumps.slice(1).filter((d) => d.at < cutoff);
  for (const d of doomed) {
    unlinkSync(d.path);
    console.log(`removed ${d.f}`);
  }
  console.log(`${dumps.length - doomed.length} kept.`);
}

const [mode, arg] = process.argv.slice(2);
try {
  if (mode === "--list") list(arg ?? "");
  else if (mode === "--prune") prune(Number(arg ?? 30));
  else take();
} catch (err) {
  const e = err as Error & { stderr?: Buffer | string };
  const detail = e.stderr ? String(e.stderr).trim() : e.message;
  console.error(`\nBackup failed: ${detail}`);
  process.exitCode = 1;
}
