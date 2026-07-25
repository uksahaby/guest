import postgres from "postgres";
import { env } from "./env.ts";

/**
 * Four connections, three of them unprivileged.
 *
 * RLS does not apply to superusers or table owners, so policies are
 * decoration unless the application connects as a restricted role
 * (db/migrations/003_rls.sql). Each surface gets the least role that can
 * do its job:
 *
 *   sqlRw     organiser + auth   — full columns, workspace-scoped rows
 *   sqlUsher  scanner            — no primary_phone, no signing_key, own legs
 *   sqlPublic guest pages        — one household, keyed on a verified pass
 *   sqlAdmin  migrations, seeds, tests — superuser, never serves a request
 *
 * Routes must not use a pool directly. They receive a transaction from
 * asUser() / asPass(), which sets the request context the policies read.
 * A query outside that context sees nothing, which is the intended
 * failure mode.
 */

const opts = { max: 10, onnotice: () => {} } as const;

function roleUrl(role: string, password: string): string {
  const explicit = process.env[`DATABASE_URL_${role.toUpperCase()}`];
  if (explicit) return explicit;
  const u = new URL(env.databaseUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

/** Superuser. Migrations, seed scripts and test fixtures only. */
export const sqlAdmin = postgres(env.databaseUrl, opts);

export const sqlRw = postgres(roleUrl("app_rw", "app_rw_dev_only"), opts);
export const sqlUsher = postgres(roleUrl("app_usher", "app_usher_dev_only"), opts);
export const sqlPublic = postgres(roleUrl("app_public", "app_public_dev_only"), opts);

/**
 * Reads event signing keys and nothing else in the database. Used only to
 * verify a guest's token before handing off to sqlPublic, which can read
 * the household but never a key.
 */
export const sqlVerify = postgres(roleUrl("app_verify", "app_verify_dev_only"), opts);

/** The handle a route works with: a transaction carrying request context. */
export type Db = postgres.TransactionSql<Record<string, never>>;

type Pool = typeof sqlRw;

/**
 * Runs `fn` in a transaction that identifies the signed-in user to the
 * policies. `set_config(..., true)` is LOCAL — it dies with the
 * transaction, so a pooled connection never leaks one request's identity
 * into the next.
 */
export async function asUser<T>(
  pool: Pool,
  userId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return pool.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as Db);
  }) as Promise<T>;
}

/** Guest pages: the context is a verified pass, not a user. */
export async function asPass<T>(
  passId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return sqlPublic.begin(async (tx) => {
    await tx`select set_config('app.pass_id', ${passId}, true)`;
    return fn(tx as Db);
  }) as Promise<T>;
}

/**
 * The login path has no user yet — find-or-create by phone happens before
 * a session exists. users and auth_otp_codes carry no RLS for that reason
 * (see 003_rls.sql) and are reachable only by app_rw.
 */
export async function asAnon<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return sqlRw.begin(async (tx) => fn(tx as Db)) as Promise<T>;
}

export async function assertDbUp(): Promise<void> {
  await sqlRw`select 1`;
}

export async function closeDb(): Promise<void> {
  await Promise.all([
    sqlAdmin.end(),
    sqlRw.end(),
    sqlUsher.end(),
    sqlPublic.end(),
    sqlVerify.end(),
  ]);
}
