import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAccount } from "./actions";
import "../(app)/org.css";

const ERRORS: Record<string, string> = {
  taken:
    "That number already has an account. Sign in instead — or if someone added you to a gate, use the link they sent you.",
  password: "Your password needs at least 10 characters.",
  name: "Please give the name that should appear on your events.",
  phone: "That number doesn't look right — use +234…",
};

/**
 * Organiser sign-up. Phone and password, no verification code, because
 * this product does not depend on an SMS provider to let its own customers
 * in.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  if ((await cookies()).get("jwt")) redirect("/events");

  return (
    <div className="org-root login-wrap">
      <div className="login-card">
        <div className="brand">
          Working name<span className="brand-dot">·</span>gtfd.ng
        </div>
        <h1>Create your account</h1>
        <p className="sub">
          Your phone number is your login. You&rsquo;ll get a recovery code on
          the next screen — keep it.
        </p>

        {sp.error && <p className="form-error">{ERRORS[sp.error] ?? ERRORS.phone}</p>}

        <form action={createAccount}>
          <input
            className="field"
            name="full_name"
            type="text"
            placeholder="Your name"
            autoComplete="name"
            maxLength={120}
            autoFocus
            required
          />
          <input
            className="field"
            name="phone"
            type="tel"
            placeholder="+234 803 411 2098"
            autoComplete="username"
            required
          />
          <input
            className="field"
            name="password"
            type="password"
            placeholder="Password (10+ characters)"
            autoComplete="new-password"
            minLength={10}
            maxLength={200}
            required
          />
          <button className="primary" type="submit">
            Create account
          </button>
        </form>

        <p className="sub" style={{ marginTop: 16, fontSize: 13 }}>
          <a href="/login?mode=password">Already have an account? Sign in</a>
        </p>
      </div>
    </div>
  );
}
