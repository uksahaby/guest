// Support recovery, run by whoever holds the database.
//
//   npx tsx scripts/reset-password.ts +2348034112098
//   npx tsx scripts/reset-password.ts +2348034112098 "a chosen password"
//
// With SMS switched off there is no self-service way back into an account:
// no code to text, and no email channel built. That is the honest cost of
// the decision, and this is the mitigation — a human with database access
// can put someone back in. It is deliberately not an API endpoint, because
// anything reachable over HTTP that resets a password is a way in.
//
// Prints a generated password when none is given. Nothing is logged
// anywhere else, and the stored value is scrypt like every other password.
import { randomBytes } from "node:crypto";
import { sqlAdmin as sql, closeDb } from "../src/db.ts";
import { hashPassword, MIN_PASSWORD } from "../src/credentials.ts";

/** Readable over the phone: no look-alike characters. */
function generated(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  const chosen = process.argv[3];

  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    throw new Error("Usage: reset-password.ts +2348034112098 [password]");
  }
  if (chosen !== undefined && chosen.length < MIN_PASSWORD) {
    throw new Error(`A password needs at least ${MIN_PASSWORD} characters.`);
  }

  const [user] = await sql`
    select id, full_name from users where phone = ${phone}`;
  if (!user) throw new Error(`No account for ${phone}.`);

  const password = chosen ?? generated();
  await sql`
    update users set password_hash = ${await hashPassword(password)}
    where id = ${user.id}`;

  console.log(`Reset for ${user.full_name || "(unnamed)"} — ${phone}`);
  if (!chosen) console.log(`Password: ${password}`);
  console.log("They can change it after signing in.");
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
