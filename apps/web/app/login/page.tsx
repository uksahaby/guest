import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestCode, signInWithPassword, verifyCode } from "./actions";
import { AuthPage, AuthTabs, BrandPanel } from "../(auth)/AuthShell";
import { PasswordInput, PhoneInput } from "../(auth)/PasswordField";
import "../(app)/org.css";
import "../(auth)/auth.css";

/**
 * Sign in, to the mockup: brand panel on the left, form on the right, and
 * the Organiser / Admin pair across the top.
 *
 * The Admin tab is not decoration. It posts the same credentials to the
 * same endpoint — there is no separate administrator password, and there
 * should not be — but it lands on /admin instead of /dashboard, and when
 * the account turns out not to be an administrator it says so rather than
 * silently dropping somebody on the organiser dashboard they did not ask
 * for.
 *
 * Three things in the mockup are absent, all for one reason: none of them
 * exist behind the glass.
 *
 *   Continue with Google / Apple — there is no OAuth anywhere, and both
 *     return an email address while this product is keyed on a phone
 *     number. A button that does nothing on a sign-in page teaches people
 *     the product is broken.
 *   Remember me — the session cookie is already thirty days.
 *   The language picker — there is one language.
 *
 * Email is likewise absent because this system has never used it to sign
 * anybody in. The phone number is the identifier (architecture decision
 * #7) and it reads 0803… as happily as +234… (phone.ts).
 */

const ERRORS: Record<string, string> = {
  phone: "That doesn't look like a phone number. 0803 411 2098 works, so does +2348034112098.",
  code: "That code didn't work. Try again.",
  password: "That phone number and password don't match.",
  throttled:
    "Too many attempts on this number. Wait a few minutes, or sign in with a code instead.",
  sms: "We couldn't send your code just now. Try again in a moment.",
  not_admin:
    "You're signed in, but this account is not a platform administrator.",
  unknown: "Something went wrong. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    step?: string; error?: string; mode?: string; as?: string; signed_in?: string;
  }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  // Someone who arrives already signed in and is not being told about a
  // wrong door has nothing to do here.
  if (jar.get("jwt") && sp.error !== "not_admin") redirect("/dashboard");

  const asAdmin = sp.as === "admin";
  const otp = sp.mode === "otp";
  const step = otp && sp.step === "code" && jar.get("login_phone") ? "code" : "phone";
  const hint = jar.get("login_hint")?.value;

  return (
    <AuthPage
      panel={
        <BrandPanel
          photo
          title={asAdmin ? "Platform administration" : "Welcome back"}
          blurb={
            asAdmin
              ? "Sign in to see the platform: organisers, events and payments across every workspace."
              : "Log in to manage your events and create unforgettable experiences."
          }
        />
      }
      foot={
        !asAdmin ? (
          <div className="adminbox">
            <span className="adminbox-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z" />
              </svg>
            </span>
            <div>
              <strong>Admin access</strong>
              <small>
                Administrators sign in here to reach the platform and every
                event on it.
              </small>
            </div>
            <Link className="ghost" href="/login?as=admin">
              Admin login →
            </Link>
          </div>
        ) : null
      }
    >
      <div className="card authcard">
        <h1>{asAdmin ? "Administrator sign-in" : "Log in to your account"}</h1>
        <p className="sub">
          {asAdmin
            ? "Your ordinary account, if it carries platform access."
            : "Access your account to manage events seamlessly."}
        </p>

        <AuthTabs current={asAdmin ? "admin" : "organiser"} />

        {sp.error && (
          <div className={`flash ${sp.error === "not_admin" ? "warn" : "bad"}`}>
            {ERRORS[sp.error] ?? ERRORS.unknown}
            {sp.error === "not_admin" && (
              <>
                {" "}
                <Link href="/dashboard">Go to my events →</Link>
              </>
            )}
          </div>
        )}

        {otp && step === "code" ? (
          <form action={verifyCode}>
            <label className="flabel" htmlFor="code">Six-digit code</label>
            <input
              id="code" className="field code-field" name="code"
              inputMode="numeric" maxLength={6} placeholder="······" autoFocus required
            />
            {hint && <p className="dev-hint">Dev code: {hint}</p>}
            <button className="primary wide" type="submit">Sign in</button>
            <p className="auth-alt">
              <Link href="/login">Use a password instead</Link>
            </p>
          </form>
        ) : otp ? (
          <form action={requestCode}>
            <label className="flabel" htmlFor="phone">Phone number</label>
            <PhoneInput autoFocus />
            <button className="primary wide" type="submit">Send me a code</button>
            <p className="auth-alt">
              <Link href={asAdmin ? "/login?as=admin" : "/login"}>
                Use a password instead
              </Link>
            </p>
          </form>
        ) : (
          <form action={signInWithPassword}>
            {asAdmin && <input type="hidden" name="as" value="admin" />}

            <label className="flabel" htmlFor="phone">Phone number</label>
            <PhoneInput autoFocus />

            <div className="labelrow">
              <label className="flabel" htmlFor="password">Password</label>
              <Link className="minor" href="/recover">Forgot password?</Link>
            </div>
            <PasswordInput />

            <button className="primary wide" type="submit">Log in</button>

            {/* Never a dead end: the code is the way in when the password
                is gone, and it needs no messaging provider in dev. */}
            <p className="auth-alt">
              <Link href={`/login?mode=otp${asAdmin ? "&as=admin" : ""}`}>
                Sign in with a code instead
              </Link>
            </p>
          </form>
        )}

        {!asAdmin && (
          <p className="auth-swap">
            Don&rsquo;t have an account? <Link href="/signup">Create account</Link>
          </p>
        )}
        {asAdmin && (
          <p className="auth-swap">
            Not an administrator? <Link href="/login">Organiser login</Link>
          </p>
        )}
      </div>
    </AuthPage>
  );
}
