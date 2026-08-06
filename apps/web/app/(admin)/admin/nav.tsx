/**
 * The platform administrator's navigation, as data.
 *
 * Deliberately NOT a client module. AdminSidebar is ("use client") because
 * it reads the current path, and a server component that imports a plain
 * array from a client module gets undefined — only components survive that
 * boundary. The section pages are server components and need this list, so
 * it lives here and both sides import it.
 *
 * Every section the mockup names is present, because the shape of the job
 * is part of the design. `built` marks the ones with something behind
 * them; the rest open a page that says plainly what it would be and why it
 * is not there, rather than a blank table or a dead switch. Same rule the
 * organiser sidebar states: nothing here leads anywhere that does not
 * exist.
 */

export type AdminItem = {
  label: string;
  href: string;
  icon: string;
  built?: boolean;
  /** Shown on the sections that are not built yet. */
  note?: string;
};

export const ADMIN_MAIN: AdminItem[] = [
  { label: "Dashboard", href: "/admin", icon: "home", built: true },
  { label: "Organizers", href: "/admin/organizers", icon: "users",
    note: "Every workspace, what they run and what they have paid. The dashboard's Top Organisers is the first slice of this." },
  { label: "Events", href: "/admin/events", icon: "calendar",
    note: "Every event on the platform, filterable by status — the list behind the ring on the dashboard." },
  { label: "Users", href: "/admin/users", icon: "user",
    note: "Organisers and ushers across all workspaces. Never guests: app_admin holds no permission on a guest list." },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: "repeat",
    note: "There are no subscriptions. Plans are one payment per event; the Professional and Organisation tiers exist in plans.ts and start with a conversation, not a form." },
  { label: "Transactions", href: "/admin/transactions", icon: "card",
    note: "Every payment, not the eight most recent. The data is real and readable — this is the list view of it." },
  { label: "Templates", href: "/admin/templates", icon: "layout",
    note: "Invitation and message templates. Nothing templated exists yet; the WhatsApp message is composed per household." },
  { label: "Reports", href: "/admin/reports", icon: "chart",
    note: "Platform-wide reporting. Per-event reports are built and live on the organiser's own Reports screen." },
  { label: "Payouts", href: "/admin/payouts", icon: "bank",
    note: "Money out. Paystack settles to one business account today, so there is nothing to split or schedule." },
  { label: "System Settings", href: "/admin/settings", icon: "cog",
    note: "Platform configuration. Everything configurable is currently an environment variable, which DEPLOY.md documents." },
  { label: "Integrations", href: "/admin/integrations", icon: "plug",
    note: "Deliberately parked. The product runs with no messaging spend at all, and that is the point of it." },
  { label: "Roles & Permissions", href: "/admin/roles", icon: "shield",
    note: "Roles are owner, event_manager and usher inside a workspace, plus this platform admin flag. Editing them from a screen is not built." },
  { label: "Audit Logs", href: "/admin/audit", icon: "list",
    note: "Worth building before anyone but you is an administrator: an admin reading a customer's business should leave a trace." },
  { label: "Support Tickets", href: "/admin/support", icon: "chat",
    note: "No ticketing system. Support today is a phone number and this database." },
];

export const ADMIN_TOOLS: AdminItem[] = [
  { label: "Email Notifications", href: "/admin/email", icon: "mail",
    note: "There is no email channel at all — not for guests, not for organisers, not for recovery." },
  { label: "Announcements", href: "/admin/announcements", icon: "megaphone",
    note: "Platform-wide notices. Nothing can currently reach an organiser inside the product." },
  { label: "Maintenance Mode", href: "/admin/maintenance", icon: "wrench",
    note: "A switch that turns the product off is a switch that can turn it off during somebody's wedding. Worth designing carefully rather than quickly." },
  { label: "System Health", href: "/admin/health", icon: "pulse", built: true },
];

export function AdminIcon({ name }: { name: string }) {
  const d: Record<string, string> = {
    home: "M3 10.5 12 3l9 7.5V21H3z",
    users: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-1a4 4 0 0 0-3-3.9",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    calendar: "M3 8h18M7 3v4m10-4v4M4 5h16v16H4z",
    repeat: "M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
    card: "M2 7h20v10H2zM2 11h20",
    layout: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
    chart: "M5 20V10m7 10V4m7 16v-7",
    bank: "M3 10h18L12 4zM5 10v8m6-8v8m6-8v8M3 20h18",
    cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8a2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0a1.6 1.6 0 0 0-2.7-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.6-2.6 2 2 0 1 1 2.8-2.8A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0a1.6 1.6 0 0 0 2.6 1.6 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 21 11a2 2 0 1 1 0 4z",
    plug: "M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4",
    shield: "M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z",
    list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
    chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
    megaphone: "M3 11v2a1 1 0 0 0 1 1h3l7 4V6L7 10H4a1 1 0 0 0-1 1M18 9a3 3 0 0 1 0 6",
    wrench: "M14.7 6.3a4 4 0 0 0 5 5L21 10a6 6 0 0 1-8.5 6.9L6 21a2.1 2.1 0 0 1-3-3l4.1-6.5A6 6 0 0 1 14 3l.7 3.3z",
    pulse: "M3 12h4l2-6 4 12 2-6h6",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d[name] ?? d.home} />
    </svg>
  );
}

