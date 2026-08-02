"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The organiser's navigation.
 *
 * Event-scoped by design: Guests, Invitations, Tables and the rest all act
 * on one event, and an organiser can be running two weddings at once. So
 * the sidebar carries the current event in its links and offers a switcher
 * rather than pretending there is only ever one.
 *
 * Nothing here leads anywhere that does not exist. A greyed-out
 * "Integrations" would be a promise the product has not made.
 */

type Item = { label: string; href: string; icon: string };

/** Above the rule: the whole account. Below it: one event. */
const GLOBAL: Item[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "My Events", href: "/events", icon: "calendar" },
];

function eventItems(id: string): Item[] {
  return [
    { label: "Guests", href: `/events/${id}/guests`, icon: "users" },
    { label: "Tables & Seating", href: `/events/${id}/tables`, icon: "grid" },
    { label: "Check-in", href: `/events/${id}/live`, icon: "scan" },
    { label: "Reports", href: `/events/${id}/report`, icon: "chart" },
    { label: "Gates & Team", href: `/events/${id}/team`, icon: "gate" },
    { label: "Event Settings", href: `/events/${id}/settings`, icon: "cog" },
  ];
}

function Icon({ name }: { name: string }) {
  // Inline so the sidebar costs no request and no client JS. Stroke-based
  // to sit correctly against the sidebar's two states.
  const d: Record<string, string> = {
    home: "M3 10.5 12 3l9 7.5V21H3z",
    calendar: "M3 8h18M7 3v4m10-4v4M4 5h16v16H4z",
    users: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-1a4 4 0 0 0-3-3.9",
    grid: "M4 5h16M4 12h16M4 19h16M9 5v14m6-14v14",
    scan: "M4 8V5h3m10 0h3v3M4 16v3h3m13-3v3h-3M8 12h8",
    chart: "M5 20V10m7 10V4m7 16v-7",
    gate: "M4 20V8l8-4 8 4v12M9 20v-6h6v6",
    cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7.5a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
    plan: "M12 3l2.5 5.5L20 9.5l-4 4 1 6-5-2.8L7 19.5l1-6-4-4 5.5-1z",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d[name] ?? d.home} />
    </svg>
  );
}

export function Sidebar({
  events,
  defaultId,
  plan,
}: {
  events: { id: string; name: string }[];
  defaultId: string | null;
  plan: string | null;
}) {
  const path = usePathname();
  const params = useSearchParams();

  // Which event the sidebar is acting on, most specific first: the event
  // whose page you are actually on, then one picked from the switcher,
  // then the dashboard's featured event.
  const fromPath = path.match(/^\/events\/([0-9a-f-]{36})/)?.[1] ?? null;
  const currentId = fromPath ?? params.get("event") ?? defaultId;
  const currentName =
    events.find((e) => e.id === currentId)?.name ?? null;
  const active = path;

  return (
    <aside className="side">
      <Link href="/dashboard" className="brand">
        <span className="brand-mark" aria-hidden="true">GT</span>
        <span>
          <strong>gtfd.ng</strong>
          <small>Events, handled</small>
        </span>
      </Link>

      <nav className="nav">
        {GLOBAL.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={`nav-link${active === i.href ? " on" : ""}`}
          >
            <Icon name={i.icon} />
            {i.label}
          </Link>
        ))}

        {currentId && (
          <>
            <div className="nav-rule">
              {/* Named so it is obvious the links below act on ONE event —
                  the commonest way to misread a sidebar like this. */}
              <span>{currentName}</span>
              {events.length > 1 && (
                <details className="switcher">
                  <summary aria-label="Switch event">Switch</summary>
                  <div className="switcher-menu">
                    {events.map((e) => (
                      <Link key={e.id} href={`/dashboard?event=${e.id}`}>
                        {e.name}
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {eventItems(currentId).map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={`nav-link${active === i.href ? " on" : ""}`}
              >
                <Icon name={i.icon} />
                {i.label}
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className="side-foot">
        {plan && (
          <div className="plan-card">
            <Icon name="plan" />
            <div>
              <strong>{plan === "free" ? "Free plan" : `${plan} plan`}</strong>
              <small>
                {plan === "free" ? "Up to 150 guests" : "Thanks for upgrading"}
              </small>
            </div>
            {currentId && (
              <Link className="ghost sm" href={`/events/${currentId}/billing`}>
                Manage
              </Link>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
