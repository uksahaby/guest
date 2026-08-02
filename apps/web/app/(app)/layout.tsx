import { Suspense } from "react";
import { Inter } from "next/font/google";
import { api, requireToken, type EventShape } from "@/lib/org-api";
import { signOut } from "../login/actions";
import { Sidebar } from "./Sidebar";
import "./org.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

export const metadata = { title: "gtfd.ng" };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireToken(); // no session → /login

  // The sidebar needs the event list on every page, so it is fetched once
  // here rather than in each one. It is the same query the events page
  // already makes; the page's own data stays its own concern.
  const { data: events } = await api<EventShape[]>("/events");

  const soonest =
    events.find((e) =>
      e.legs?.some((l) => new Date(l.starts_at) >= new Date()),
    ) ??
    events[0] ??
    null;

  return (
    <div className={`${inter.variable} org-root`}>
      <div className="shell">
        {/* useSearchParams needs a Suspense boundary, or the whole route
            opts out of static rendering and says so at build time. */}
        <Suspense fallback={<aside className="side" />}>
          <Sidebar
            events={events.map((e) => ({ id: e.id, name: e.name }))}
            defaultId={soonest?.id ?? null}
            plan={soonest?.plan ?? null}
          />
        </Suspense>

        <div className="col">
          <header className="topbar">
            <div className="spacer" />
            <form action={signOut}>
              <button className="ghost sm" type="submit">
                Sign out
              </button>
            </form>
          </header>
          <main className="main">{children}</main>
        </div>
      </div>
    </div>
  );
}
