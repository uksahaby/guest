// Reading apps/api/.env, for the two things that need it.
//
// Split out of env.ts because env.ts throws on a missing DATABASE_URL or
// JWT_SECRET the moment it is imported. That is right for the server —
// booting half-configured is worse than not booting — and wrong for the
// tools, which need the file read without also being told the app cannot
// start. scripts/backup.ts imported env.ts's behaviour by copying nothing
// and so read no .env at all: `npm run backup`, exactly as DEPLOY.md
// documents it, failed with "set SUPERUSER_URL" on a machine where the URL
// was sitting in .env the whole time.
//
// No dotenv dependency: this file works the same under tsx, under the test
// runner, and in production, where real environment variables simply win.

import { readFileSync } from "node:fs";

/**
 * Fill process.env from a .env file, without overwriting anything already
 * set. A real environment variable always beats the file — that is what
 * makes a production deploy, a test run and a one-off
 * `DATABASE_URL=... npm run backup` all behave the way you would expect.
 *
 * Missing file is not an error. Deployments have no .env at all.
 */
export function loadDotEnv(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}
