import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { recoverAccount } from "./actions";
import "../(app)/org.css";

/**
 * Forgotten password. No text message, no email — the recovery code given
 * at sign-up is the way in, and using it issues a fresh one.
 */
export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  if ((await cookies()).get("jwt")) redirect("/dashboard");

  return (
    <div className="org-root login-wrap">
      <div className="login-card">
        <div className="brand">
          Working name<span className="brand-dot">·</span>gtfd.ng
        </div>
        <h1>Forgotten your password</h1>
        <p className="sub">
          Enter the recovery code you were given when you created your
          account, and choose a new password.
        </p>

        {sp.error === "code" && (
          <p className="form-error">
            That number and recovery code don&rsquo;t match.
          </p>
        )}
        {sp.error === "password" && (
          <p className="form-error">
            Your new password needs at least 10 characters.
          </p>
        )}

        <form action={recoverAccount}>
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
            name="recovery_code"
            type="text"
            placeholder="Recovery code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <input
            className="field"
            name="password"
            type="password"
            placeholder="New password (10+ characters)"
            autoComplete="new-password"
            minLength={10}
            required
          />
          <button className="primary" type="submit">
            Set new password
          </button>
        </form>

        <p className="sub" style={{ marginTop: 16, fontSize: 13 }}>
          Lost the code too? Only whoever runs the system can help — there is
          no other way in, by design.
        </p>
      </div>
    </div>
  );
}
