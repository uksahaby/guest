import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireToken } from "@/lib/org-api";
import "../../(app)/org.css";

/**
 * The recovery code, shown exactly once.
 *
 * With SMS off and no email channel, this is the only self-service way
 * back into an account. It is stored as a hash, so nobody — including us —
 * can show it again. The page says that plainly rather than letting
 * someone assume they can come back for it.
 */
export default async function RecoveryPage() {
  await requireToken();
  const jar = await cookies();
  const code = jar.get("recovery_code")?.value;

  // Nothing to show means it has already been read, or someone wandered
  // here later. Either way there is no second look.
  if (!code) redirect("/dashboard");

  return (
    <div className="org-root login-wrap">
      <div className="login-card">
        <div className="brand">
          Working name<span className="brand-dot">·</span>gtfd.ng
        </div>
        <h1>Write this down</h1>
        <p className="sub">
          If you forget your password, this code is the only way back into
          your account. We can&rsquo;t show it again and we can&rsquo;t look
          it up.
        </p>

        <p
          style={{
            fontSize: 26,
            letterSpacing: "0.08em",
            fontWeight: 600,
            textAlign: "center",
            padding: "18px 0",
            userSelect: "all",
          }}
        >
          {code}
        </p>

        {/* Reading it clears it: the cookie is the only copy the browser
            ever holds, and it should not outlive this page. */}
        <form
          action={async () => {
            "use server";
            (await cookies()).delete("recovery_code");
            redirect("/dashboard");
          }}
        >
          <button className="primary" type="submit">
            I&rsquo;ve written it down
          </button>
        </form>
      </div>
    </div>
  );
}
