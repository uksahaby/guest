"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_MAIN, ADMIN_TOOLS, AdminIcon, type AdminItem } from "./nav";
import { Brand } from "@/app/brand";

/**
 * The platform administrator's navigation, to the mockup.
 *
 * Every section the design names is here, because the shape of the job is
 * part of the design and hiding two thirds of it would misrepresent what
 * this screen is for. What each one does when you arrive is another
 * matter: `built` marks the ones with something behind them, and the rest
 * open a page that says plainly it is not built rather than a blank panel
 * or a dead switch.
 *
 * That is the same rule the organiser sidebar states — "nothing here leads
 * anywhere that does not exist" — applied honestly to a screen whose whole
 * subject is what the platform can do.
 */

export function AdminSidebar({ name }: { name: string | null }) {
  const path = usePathname();
  const initials = (name ?? "?")
    .trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "").join("");

  const link = (i: AdminItem) => (
    <Link
      key={i.href}
      href={i.href}
      className={`nav-link${path === i.href ? " on" : ""}`}
      aria-current={path === i.href ? "page" : undefined}
    >
      <AdminIcon name={i.icon} />
      {i.label}
    </Link>
  );

  return (
    <aside className="side admin-side">
      <Link href="/admin" className="brand">
        <Brand tone="dark" size="sm" />
      </Link>

      <nav className="nav admin-nav">
        <div className="nav-head">Super admin</div>
        {ADMIN_MAIN.map(link)}
        <div className="nav-head">Tools</div>
        {ADMIN_TOOLS.map(link)}
      </nav>

      <div className="side-foot">
        {/* Out again. An administrator is also an organiser with their own
            events, and a surface you can only leave by editing the URL is
            a trap. */}
        <Link href="/dashboard" className="nav-link back-out">
          <AdminIcon name="home" />
          Back to my events
        </Link>
        <div className="admin-me">
          <span className="me-avatar" aria-hidden="true">{initials || "?"}</span>
          <div>
            <strong>{name || "Administrator"}</strong>
            <small>Super admin</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
