// Test database bootstrap. Import this FIRST in any test file, before any
// module that touches ./db.ts — it points DATABASE_URL at a disposable
// database recreated from spec/schema-v1.sql on every run.
//
// Tests must never run against guest_dev: check_in_events is append-only
// (trigger blocks UPDATE and DELETE), so test rows would accumulate forever.
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const schemaFile = join(root, "spec", "schema-v1.sql");
const migrationsDir = join(root, "db", "migrations");
const TEST_DB = "guest_test";

process.env.DATABASE_URL = `postgres://postgres@localhost:5432/${TEST_DB}`;
process.env.JWT_SECRET ??= "test-secret";

// Pin every RLS role at the throwaway database too, and do it by SETTING
// rather than deleting: env.ts fills anything still undefined from .env, so
// a developer whose .env holds production role URLs would otherwise have
// the app connections in a test run pointing at a real database while the
// admin connection stayed local. That is a very quiet way to write test
// rows into production.
for (const role of ["app_rw", "app_usher", "app_public", "app_verify", "app_billing", "app_admin"]) {
  process.env[`DATABASE_URL_${role.toUpperCase()}`] =
    `postgres://${role}:${role}_dev_only@localhost:5432/${TEST_DB}`;
}

function psql(args: string): void {
  execSync(`psql -U postgres -h localhost ${args}`, { stdio: "pipe" });
}

psql(`-d postgres -c "drop database if exists ${TEST_DB} with (force)"`);
psql(`-d postgres -c "create database ${TEST_DB}"`);
psql(`-d ${TEST_DB} -v ON_ERROR_STOP=1 -f "${schemaFile}"`);
for (const f of readdirSync(migrationsDir).sort()) {
  if (f.endsWith(".sql")) {
    psql(`-d ${TEST_DB} -v ON_ERROR_STOP=1 -f "${join(migrationsDir, f)}"`);
  }
}
