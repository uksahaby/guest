import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Drops the session and sends you to the login form.
 *
 * This exists because of a loop found while running the app against a
 * different API: a cookie the API no longer accepts sent every request
 * round in circles. `api()` saw the 401 and redirected to /login, /login
 * saw a cookie still sitting there and redirected to /dashboard, and the
 * browser spun between the two forever with a blank page.
 *
 * That is not an edge case. `DEPLOY.md` says rotating JWT_SECRET signs
 * everyone out, and every one of those organisers would have met this
 * instead of a login form. So a 401 now comes here, where the cookie can
 * actually be deleted — a Server Component cannot, because headers are
 * already on their way by then.
 *
 * GET rather than POST on purpose: it is reached by redirect, not by a
 * form, and it destroys nothing but a token the server has already
 * refused. The deliberate sign-out button still posts to its own action.
 */
export async function GET() {
  const jar = await cookies();
  jar.delete("jwt");
  redirect("/login");
}
