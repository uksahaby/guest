import postgres from "postgres";
import { env } from "./env.ts";

// postgres.js client. Drizzle can wrap this same client once the schema is
// introspected; raw tagged-template SQL is fine for the first endpoints and
// stays close to spec/schema-v1.sql, which remains the source of truth.
export const sql = postgres(env.databaseUrl, {
  // scanner sync bursts are many small statements; keep the pool modest
  max: 10,
  onnotice: () => {},
});

export async function assertDbUp(): Promise<void> {
  await sql`select 1`;
}
