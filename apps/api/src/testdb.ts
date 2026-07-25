// Test database bootstrap. Import this FIRST in any test file, before any
// module that touches ./db.ts — it points DATABASE_URL at a disposable
// database recreated from spec/schema-v1.sql on every run.
//
// Tests must never run against guest_dev: check_in_events is append-only
// (trigger blocks UPDATE and DELETE), so test rows would accumulate forever.
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaFile = join(here, "..", "..", "..", "spec", "schema-v1.sql");
const TEST_DB = "guest_test";

process.env.DATABASE_URL = `postgres://postgres@localhost:5432/${TEST_DB}`;
process.env.JWT_SECRET ??= "test-secret";

function psql(args: string): void {
  execSync(`psql -U postgres -h localhost ${args}`, { stdio: "pipe" });
}

psql(`-d postgres -c "drop database if exists ${TEST_DB} with (force)"`);
psql(`-d postgres -c "create database ${TEST_DB}"`);
psql(`-d ${TEST_DB} -v ON_ERROR_STOP=1 -f "${schemaFile}"`);
