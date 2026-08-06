import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAccount } from "./actions";
import { AuthPage, BrandPanel, Perk } from "../(auth)/AuthShell";
import { NewPasswordFields, PhoneInput } from "../(auth)/PasswordField";
import "../(app)/org.css";
import "../(auth)/auth.css";

/**
 * Create an organiser account, to the mockup.
 *
 * No verification code and nothing to pay a messaging provider for: the
 * phone number is the identifier and the password is the credential. The
 * recovery code on the next screen is the only way back in, which is why
 * that screen exists at all.
 *
 * Absent from the mockup's version, and why:
 *
 *   Email — this system has never signed anybody in with one.
 *   Sign up with Google / Apple — no OAuth, and both would hand us an
 *     email address in place of the phone number everything is keyed on.
 *   The terms and privacy checkbox — there are no such pages to agree to.
 *     Asking somebody to accept documents that do not exist is worse than
 *     not asking. It belongs here the day they are written.
 *
 * The password rules shown are the rules actually enforced: ten
 * characters, no composition requirements (credentials.ts). The mockup's
 * "one uppercase, one number" is not checked by anything.
 */

const ERRORS: Record<string, string> = {
  taken:
    "That number already has an account. Sign in instead — or if someone added you to a gate, use the link they sent you.",
  password: "Your password needs at least 10 characters.",
  name: "Please give the name that should appear on your events.",
  phone: "That doesn't look like a phone number. 0803 411 2098 works, so does +2348034112098.",
  throttled: "Too many accounts created from here just now. Try again shortly.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  if ((await cookies()).get("jwt")) redirect("/dashboard");

  return (
    <AuthPage
      panel={
        <BrandPanel
          title="Create your account"
          blurb="Join the organisers who use this to get the right people through the door."
        >
          <div className="perks">
            <Perk
              icon="calendar"
              title="Every event in one place"
              body="Plan it, invite the households, and watch the gate on the day."
            />
            <Perk
              icon="users"
              title="Guests, not spreadsheets"
              body="One pass per household, replies collected, seating arranged."
            />
            <Perk
              icon="chart"
              title="The report afterwards"
              body="Who came, who didn't, and what happened at every gate."
            />
          </div>
        </BrandPanel>
      }
    >
      <div className="card authcard">
        <h1>Create your account</h1>
        <p className="sub">Fill in the details below to get started.</p>

        {sp.error && (
          <div className="flash bad">{ERRORS[sp.error] ?? ERRORS.phone}</div>
        )}

        <form action={createAccount}>
          <label className="flabel" htmlFor="full_name">Full name</label>
          <div className="inputwrap">
            <span className="lead">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8" />
              </svg>
            </span>
            <input
              id="full_name" className="field" name="full_name" type="text"
              placeholder="Enter your full name" autoComplete="name"
              maxLength={120} autoFocus required
            />
          </div>
          <span className="phint">
            It appears on your events and names your workspace.
          </span>

          <label className="flabel" htmlFor="phone">Phone number</label>
          <PhoneInput />
          <span className="phint">
            This is how you sign in. 0803 411 2098 or +2348034112098 — either
            reads the same.
          </span>

          <NewPasswordFields />

          <button className="primary wide" type="submit">Create account</button>
        </form>

        <p className="auth-swap">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </AuthPage>
  );
}
