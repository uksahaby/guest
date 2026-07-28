import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestCode, signInWithPassword, verifyCode } from "./actions";
import "../(app)/org.css";

/**
 * Organiser sign-in — phone first, per mockups/auth-usher-admin.html.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  if (jar.get("jwt")) redirect("/events");

  const password = sp.mode === "password";
  const step = sp.step === "code" && jar.get("login_phone") ? "code" : "phone";
  const hint = jar.get("login_hint")?.value;

  return (
    <div className="org-root login-wrap">
      <div className="login-card">
        <div className="brand">
          Working name<span className="brand-dot">·</span>gtfd.ng
        </div>
        <h1>{step === "phone" ? "Welcome back" : "Enter your code"}</h1>
        <p className="sub">
          {password
            ? "Your phone number and password."
            : step === "phone"
              ? "Your phone number is your login. We'll text you a code."
              : "We sent a six-digit code to your phone."}
        </p>

        {sp.error === "phone" && (
          <p className="form-error">That number doesn&rsquo;t look right — use +234…</p>
        )}
        {sp.error === "code" && (
          <p className="form-error">That code didn&rsquo;t work. Try again.</p>
        )}
        {sp.error === "password" && (
          <p className="form-error">
            That phone number and password don&rsquo;t match.
          </p>
        )}
        {sp.error === "sms" && (
          <p className="form-error">
            We couldn&rsquo;t send your code just now. Try again in a moment.
          </p>
        )}
        {sp.error === "unknown" && (
          <p className="form-error">Something went wrong. Try again.</p>
        )}

        {password ? (
          <>
            <form action={signInWithPassword}>
              <input
                className="field"
                name="phone"
                type="tel"
                placeholder="+234 803 411 2098"
                autoComplete="username"
                autoFocus
                required
              />
              <input
                className="field"
                name="password"
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                required
              />
              <button className="primary" type="submit">
                Sign in
              </button>
            </form>
            {/* Never a dead end: OTP is the way back in from a forgotten
                password, so it stays one tap away. */}
            <p className="sub" style={{ marginTop: 16, fontSize: 13 }}>
              <a href="/recover">Forgotten your password?</a>
            </p>
          </>
        ) : step === "phone" ? (
          <form action={requestCode}>
            <input
              className="field"
              name="phone"
              type="tel"
              placeholder="+234 803 411 2098"
              autoFocus
              required
            />
            <button className="primary" type="submit">
              Send code
            </button>
          </form>
        ) : null}

        {!password && step === "phone" && (
          <p className="sub" style={{ marginTop: 16, fontSize: 13 }}>
            <a href="/login?mode=password">Sign in with a password instead</a>
            {" · "}
            <a href="/signup">Create an account</a>
          </p>
        )}

        {!password && step === "code" ? (
          <form action={verifyCode}>
            <input
              className="field code-field"
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="······"
              autoFocus
              required
            />
            {hint && <p className="dev-hint">Dev code: {hint}</p>}
            <button className="primary" type="submit">
              Sign in
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
