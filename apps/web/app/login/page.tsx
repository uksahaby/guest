import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestCode, verifyCode } from "./actions";
import "../(app)/org.css";

/**
 * Organiser sign-in — phone first, per mockups/auth-usher-admin.html.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  if (jar.get("jwt")) redirect("/events");

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
          {step === "phone"
            ? "Your phone number is your login. We'll text you a code."
            : "We sent a six-digit code to your phone."}
        </p>

        {sp.error === "phone" && (
          <p className="form-error">That number doesn&rsquo;t look right — use +234…</p>
        )}
        {sp.error === "code" && (
          <p className="form-error">That code didn&rsquo;t work. Try again.</p>
        )}

        {step === "phone" ? (
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
        ) : (
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
        )}
      </div>
    </div>
  );
}
