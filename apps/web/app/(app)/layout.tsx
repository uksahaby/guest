import { Inter } from "next/font/google";
import Link from "next/link";
import { requireToken } from "@/lib/org-api";
import { signOut } from "../login/actions";
import "./org.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const metadata = { title: "Dashboard" };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireToken(); // no session → /login

  return (
    <div className={`${inter.variable} org-root`}>
      <div className="shell">
        <aside className="side">
          <div className="brand">
            Working name<span className="brand-dot">·</span>gtfd.ng
          </div>
          <Link className="nav-link" href="/events">
            Events
          </Link>
          <div className="side-foot">
            <form action={signOut}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
