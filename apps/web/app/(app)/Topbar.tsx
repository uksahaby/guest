import Link from "next/link";
import { signOut } from "../login/actions";

/**
 * The bar across the top: what needs attention, and who is signed in.
 *
 * The profile menu is a <details>, not a click handler. It opens, closes
 * on Escape, and works before any JavaScript has arrived — which on
 * Nigerian mobile data is a real state a page spends time in, not a
 * hypothetical one.
 *
 * The notification count is not a number we invented. It is the readiness
 * items that are due now, which is the only thing in this product that
 * genuinely wants the organiser's attention today. A bell with a red 3 on
 * it that means nothing is how people learn to stop looking at bells.
 */
export function Topbar({
  name,
  hasAvatar,
  dueNow,
  eventId,
  isPlatformAdmin,
}: {
  name: string | null;
  hasAvatar: boolean;
  dueNow: number;
  eventId: string | null;
  /** Shows the door. The API is what actually unlocks it. */
  isPlatformAdmin?: boolean;
}) {
  const first = (name ?? "").trim().split(/\s+/)[0] || "there";
  const initials = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <header className="topbar">
      <div className="spacer" />

      <Link
        className="bell"
        href={eventId ? `/events/${eventId}` : "/dashboard"}
        aria-label={
          dueNow > 0 ? `${dueNow} things need attention` : "Nothing needs attention"
        }
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {dueNow > 0 && <span className="badge-dot">{dueNow}</span>}
      </Link>

      <details className="profile">
        <summary aria-label={`Signed in as ${name ?? "you"}`}>
          <span className="me-avatar" aria-hidden="true">
            {hasAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/me/avatar" alt="" />
            ) : (
              initials || "?"
            )}
          </span>
          <span className="me-who">
            <strong>{name ?? "Your account"}</strong>
            <small>Organiser</small>
          </span>
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>

        <div className="profile-menu">
          <div className="menu-head">
            <strong>Hello, {first}</strong>
            <small>{name ?? ""}</small>
          </div>
          {/* An administrator is an ordinary organiser with one extra
              place to go, so this sits with the account links rather than
              in the event sidebar. Absent entirely for everyone else —
              there is no greyed-out version of it to notice. */}
          {isPlatformAdmin && (
            <Link href="/admin" className="admin-jump">Super admin</Link>
          )}
          <Link href="/profile">Your profile</Link>
          <Link href="/events">Your events</Link>
          {eventId && <Link href={`/events/${eventId}/billing`}>Billing &amp; plan</Link>}
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </details>
    </header>
  );
}
