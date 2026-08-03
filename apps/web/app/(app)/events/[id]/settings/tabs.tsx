/**
 * The settings tabs, in the mockup's order.
 *
 * `built` is not decoration. Four of these have no product behind them
 * yet, and the sidebar's rule applies here too: a control that looks live
 * and does nothing is a promise the product has not made. They render, so
 * the shape of the screen is honest about where things will live, and they
 * say plainly that they are not built rather than offering dead switches.
 */

export type TabKey =
  | "details" | "venue" | "branding" | "invitations" | "rsvp" | "checkin"
  | "passes" | "notifications" | "privacy" | "integrations" | "advanced";

export type Tab = {
  key: TabKey;
  label: string;
  icon: string;
  built: boolean;
  /** Shown on the tabs that are not built yet. */
  coming?: string;
};

export const TABS: Tab[] = [
  { key: "details", label: "Event Details", icon: "list", built: true },
  { key: "venue", label: "Venue & Time", icon: "pin", built: true },
  {
    key: "branding", label: "Branding", icon: "brush", built: false,
    coming:
      "Your own colours and typeface on the invitation and the guest page. " +
      "Today every event uses the house style, and the cover photo on Event " +
      "Details is the one thing that makes it yours.",
  },
  {
    key: "invitations", label: "Invitation Settings", icon: "mail", built: false,
    coming:
      "The wording of the WhatsApp message, and who it goes to. Today the " +
      "message is composed on the Invitations screen, one household at a time.",
  },
  { key: "rsvp", label: "RSVP Settings", icon: "check", built: true },
  { key: "checkin", label: "Check-in Settings", icon: "target", built: true },
  { key: "passes", label: "QR Pass Settings", icon: "qr", built: true },
  {
    key: "notifications", label: "Notifications", icon: "bell", built: false,
    coming:
      "Being told when replies arrive and when the gate gets busy. Nothing " +
      "sends you anything yet — the live check-in screen is where the day is " +
      "watched.",
  },
  { key: "privacy", label: "Privacy & Visibility", icon: "lock", built: true },
  {
    key: "integrations", label: "Integrations", icon: "plug", built: false,
    coming:
      "Calendars, and the paid WhatsApp Business API for automatic sending. " +
      "Deliberately parked: the product runs today with no messaging spend at " +
      "all, and that is the point of it.",
  },
  { key: "advanced", label: "Advanced Settings", icon: "cog", built: true },
];

export function TabIcon({ name }: { name: string }) {
  const d: Record<string, string> = {
    list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
    pin: "M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
    brush: "M4 20s2-1 4-1 3 1 5 1 4-2 4-5M6 15 15 6a2.8 2.8 0 0 1 4 4l-9 9z",
    mail: "M3 6h18v12H3zM3 7l9 6 9-6",
    check: "M9 12.5l2.2 2.2L15.5 10M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
    qr: "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9 9h2v2H9zM13 13h2v2h-2z",
    bell: "M18 15v-4a6 6 0 1 0-12 0v4l-2 3h16zM10 21h4",
    lock: "M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3",
    plug: "M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4",
    cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 5.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d[name] ?? d.cog} />
    </svg>
  );
}
