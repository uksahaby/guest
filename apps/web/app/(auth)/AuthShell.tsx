import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { Brand } from "@/app/brand";

/**
 * Cormorant Garamond for the headings, as the mockups set them — the same
 * face the guest surface already uses, and for the same reason recorded
 * there: not Playfair, because the reflexive wedding choice reads as
 * templated. Inter carries everything a person has to read quickly —
 * labels, fields, buttons, errors — because a display serif at 12px is a
 * decoration that costs legibility.
 */
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

/**
 * The split screen both sign-in mockups share: a dark branded panel on the
 * left, the form on the right.
 *
 * The left panel is decoration on a phone and disappears there — it costs
 * a full-bleed photograph, and this page loads on Nigerian mobile data
 * before anyone has decided to trust us. The form is what matters and it
 * comes first in the markup, so it is also what a screen reader reaches
 * first.
 */

export function BrandPanel({
  title,
  blurb,
  photo = false,
  children,
}: {
  title: string;
  blurb: string;
  /**
   * The reception photograph under the welcome, as the sign-in mockup has
   * it. Sign-up deliberately has none — its mockup fills that space with
   * what the product does instead, which is the more useful thing to show
   * somebody who has not decided yet.
   *
   * Set as a CSS background rather than an <img>: the panel is display:none
   * below 900px, and browsers do not fetch a background for an element
   * that is not rendered. So the one page that loads before anybody has
   * decided to trust us costs a phone nothing extra.
   */
  photo?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <aside className={`auth-brand${photo ? " with-photo" : ""}`} aria-hidden={false}>
      <div className="auth-brand-inner">
        <div className="auth-logo">
          <Brand tone="dark" size="lg" />
        </div>

        <div className="auth-pitch">
          <h2>{title}</h2>
          <p>{blurb}</p>
          {children}
        </div>
      </div>
    </aside>
  );
}

export function AuthPage({
  panel,
  children,
  foot,
}: {
  panel: React.ReactNode;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className={`${cormorant.variable} org-root auth-root`}>
      <div className="auth-split">
        {panel}
        <main className="auth-main">
          <div className="auth-col">
            {children}
            {foot}
            <p className="auth-secure">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z" />
              </svg>
              Your data is secure with us. We never share your information.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Bullet with an icon, for the sign-up panel. */
export function Perk({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  const d: Record<string, string> = {
    calendar: "M3 8h18M7 3v4m10-4v4M4 5h16v16H4z",
    users: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-1a4 4 0 0 0-3-3.9",
    chart: "M5 20V10m7 10V4m7 16v-7",
    help: "M4 14v-3a8 8 0 0 1 16 0v3M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2m16 0a2 2 0 0 0-2-2h-1v5h1a2 2 0 0 0 2-2m-2 2v1a3 3 0 0 1-3 3h-2",
  };
  return (
    <div className="perk">
      <span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={d[icon] ?? d.calendar} />
        </svg>
      </span>
      <div>
        <strong>{title}</strong>
        <small>{body}</small>
      </div>
    </div>
  );
}

/** "Organiser" / "Admin", as the mockup has them. */
export function AuthTabs({ current }: { current: "organiser" | "admin" }) {
  return (
    <div className="auth-tabs" role="tablist" aria-label="How you are signing in">
      <Link
        href="/login"
        role="tab"
        aria-selected={current === "organiser"}
        className={current === "organiser" ? "on" : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-1a4 4 0 0 0-3-3.9" />
        </svg>
        Organiser login
      </Link>
      <Link
        href="/login?as=admin"
        role="tab"
        aria-selected={current === "admin"}
        className={current === "admin" ? "on" : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z" />
        </svg>
        Admin login
      </Link>
    </div>
  );
}
