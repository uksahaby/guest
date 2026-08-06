// Who can see the whole platform.
//
//   npx tsx scripts/platform-admin.ts                       list them
//   npx tsx scripts/platform-admin.ts +2348037641886 "Zakia Waziri"
//   npx tsx scripts/platform-admin.ts +2348037641886 --revoke
//
// A script and not an endpoint, for the same reason reset-password.ts is a
// script: anything reachable over HTTP that can grant itself sight of every
// customer is a way in. Granting this requires the superuser connection
// string, which means a human who already has the database.
//
// What it grants is deliberately bounded — app_admin reads organisers,
// events and payments and holds no permission at all on guest lists
// (db/migrations/019). Promoting someone does not let them read a wedding.
import { randomUUID } from "node:crypto";
import { sqlAdmin as sql, closeDb } from "../src/db.ts";
import { toE164 } from "../src/phone.ts";

const [rawPhone, ...rest] = process.argv.slice(2);
const revoke = rest.includes("--revoke");
const name = rest.filter((a) => !a.startsWith("--")).join(" ").trim();

async function list(): Promise<void> {
  const rows = await sql`
    select phone, full_name, last_seen_at from users
    where is_platform_admin order by full_name`;
  if (rows.length === 0) {
    console.log("No platform administrators.");
    return;
  }
  console.log(`${rows.length} platform administrator(s):`);
  for (const r of rows) {
    const seen = r.last_seen_at
      ? new Date(r.last_seen_at).toISOString().slice(0, 10)
      : "never signed in";
    console.log(`  ${r.phone}  ${r.full_name || "(no name)"}  — ${seen}`);
  }
}

try {
  if (!rawPhone) {
    await list();
  } else {
    const phone = toE164(rawPhone);
    if (!phone) {
      throw new Error(
        `"${rawPhone}" is not a phone number. 0803 411 2098 or +2348034112098 both work.`,
      );
    }

    if (revoke) {
      const [u] = await sql`
        update users set is_platform_admin = false
        where phone = ${phone} returning full_name, phone`;
      console.log(
        u ? `Revoked — ${u.full_name || u.phone} is no longer a platform admin.`
          : `No account for ${phone}.`,
      );
    } else {
      // Find or create. An administrator is an ordinary account with the
      // flag set, so they sign in the same way as anybody else: OTP, or a
      // password they set themselves. This script never sets one — nobody
      // should know somebody else's password (HANDOFF §3).
      const [u] = await sql`
        insert into users (id, phone, full_name, is_platform_admin)
        values (${randomUUID()}, ${phone}, ${name || ""}, true)
        on conflict (phone) do update set
          is_platform_admin = true,
          full_name = case
            when users.full_name = '' then coalesce(${name || null}, users.full_name)
            else users.full_name
          end
        returning id, phone, full_name, password_hash is not null as has_password`;

      console.log(`${u!.full_name || "(no name)"} — ${u!.phone}`);
      console.log("Platform admin: yes");
      console.log(
        u!.has_password
          ? "Signs in with their existing password, or an OTP."
          : "No password set. They sign in with an OTP, or set one at /signup " +
            "if the number is not yet taken. To give them one directly:\n" +
            `  npx tsx scripts/reset-password.ts ${u!.phone}`,
      );
    }
  }
} catch (err) {
  console.error(`\nFailed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
