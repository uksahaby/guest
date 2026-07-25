// Minimal env loading — no dotenv dependency; parse .env ourselves so the
// file works the same under tsx, tests, and production (where real env
// vars simply win).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

try {
  const raw = readFileSync(join(here, "..", ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
} catch {
  // No .env file — rely on real environment variables.
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  port: Number(process.env.PORT ?? 3001),
  isDev: process.env.NODE_ENV !== "production",
  /** Where guest pages live — used to build invitation links. */
  webUrl: process.env.WEB_URL ?? "http://localhost:3000",
};
