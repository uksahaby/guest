import { acceptInvite } from "./actions";
import "../../(app)/org.css";

/**
 * The usher's whole sign-up: tap a link, tap a button, you're on the gate.
 *
 * No phone number to type, no code to wait for, no password to remember —
 * the link was sent to one number over WhatsApp and holding it is the
 * proof, exactly as it is for a guest's pass.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  return (
    <div className="org-root login-wrap">
      <div className="login-card">
        <div className="brand">
          Working name<span className="brand-dot">·</span>gtfd.ng
        </div>
        <h1>You&rsquo;ve been added to a gate</h1>
        <p className="sub">
          Tap below to start checking guests in. Nothing to install and no
          code to wait for.
        </p>

        {sp.error && (
          <p className="form-error">
            This link has expired or has already been used. Ask the organiser
            to send you a new one.
          </p>
        )}

        <form action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <button className="primary" type="submit">
            Start checking in
          </button>
        </form>

        <p className="sub" style={{ marginTop: 18, fontSize: 13 }}>
          This link works once, on this phone. Don&rsquo;t forward it.
        </p>
      </div>
    </div>
  );
}
