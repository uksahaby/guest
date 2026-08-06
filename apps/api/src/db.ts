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

  // The dev passwords are in 003_rls.sql, which is public. Falling back to
  // them in production would either fail at connect time with something
  // opaque, or — worse, if someone reused them — quietly work. Neither is
  // a thing to discover on event day.
  if (!env.isDev) {
    throw new Error(
      `Missing DATABASE_URL_${role.toUpperCase()}. Production must set a URL ` +
        `for every RLS role; the superuser URL bypasses every policy.`,
    );
  }

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

/**
 * Provider webhooks arrive with no session, so they cannot use asUser.
 * app_billing reaches payments and the three billing columns of events,
 * and only for events someone has started paying for.
 */
export const sqlBilling = postgres(roleUrl("app_billing", "app_billing_dev_only"), opts);

/**
 * The platform administrator's view of the business (db/migrations/019).
 *
 * Read-only, and deliberately blind to guest data: no grant exists on
 * invitations, passes, check_in_events or seating_tables, so a query that
 * reaches for a guest list fails rather than returning one. Sizes come
 * back through admin_event_size(), which counts without reading.
 */
export const sqlPlatform = postgres(roleUrl("app_admin", "app_admin_dev_only"), opts);

/**
 * No context to set — this role sees every row by policy. It is a
 * transaction for consistency of the numbers on one dashboard, not for
 * scoping.
 */
export async function asPlatform<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return sqlPlatform.begin(async (tx) => fn(tx as Db)) as Promise<T>;
}

/** The handle a route works with: a transaction carrying request context. */
export type Db = postgres.TransactionSql<Record<string, never>>;

type Pool = typeof sqlRw;

/**
 * Runs `fn` in a transaction that identifies the signed-in user to the
 * policies. `set_config(..., true)` is LOCAL — it dies with the
 * transaction, so a pooled connection never leaks one request's identity
 * into the next.
 *
 * DO NOT call reply.send() inside `fn` on a path that writes. The reply
 * would go out before the transaction commits, so a client can act on
 * "created" and then read back nothing — and if the commit then failed it
 * would already have been told success. Return a value (or a
 * {code, body} description) and send it after this resolves.
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
 * The public event page: no pass, no user, no context at all.
 *
 * Deliberately sets nothing. Every other app_public policy is keyed on
 * app_pass_invitation(), which is null here, so with no context this
 * connection can see exactly the two things db/migrations/018 opened —
 * events and legs whose organiser turned the public page on — and none of
 * the guest data those policies protect.
 */
export async function asPublic<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return sqlPublic.begin(async (tx) => fn(tx as Db)) as Promise<T>;
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
    sqlBilling.end(),
    sqlPlatform.end(),
  ]);
}
