import { redirect } from "next/navigation";
import { api, requireToken } from "@/lib/org-api";
import { saveName } from "./actions";
import "../(app)/org.css";

/**
 * The one question onboarding asks. Sign-in is phone-only, so without this
 * every organiser stays nameless: their own workspace falls back to "My
 * events", and ushers see them as "Not named yet" in the team list and in
 * every report.
 *
 * Reuses the login card styles — same moment, same shape.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  await requireToken();

  // Nothing to ask if they already have a name — someone landing here by
  // typing the URL should not be made to re-enter it.
  const { data } = await api<{ user: { full_name: string | null } }>("/me");
  if (String(data?.user?.full_name ?? "").trim()) redirect("/events");

  return (
    <div className="org-root login-wrap">
      <div className="login-card">
        <div className="brand">
          Working name<span className="brand-dot">·</span>gtfd.ng
        </div>
        <h1>What should we call you?</h1>
        <p className="sub">
          Your name appears on your events and to the ushers working your
          gates. You can change it later.
        </p>

        {sp.error === "name" && (
          <p className="form-error">Please enter a name.</p>
        )}
        {sp.error === "save" && (
          <p className="form-error">That didn&rsquo;t save. Try again.</p>
        )}

        <form action={saveName}>
          <input
            className="field"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="Ahmed Bello"
            maxLength={120}
            autoFocus
            required
          />
          <button className="primary" type="submit">
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
