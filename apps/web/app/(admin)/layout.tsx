import { Suspense } from "react";
import { Inter } from "next/font/google";
import { redirect } from "next/navigation";
import { api, requireToken } from "@/lib/org-api";
import { AdminSidebar } from "./admin/AdminSidebar";
import "../(app)/org.css";
import "./admin.css";

/**
 * The platform administrator's shell.
 *
 * Guarded twice, deliberately. The API refuses /admin/* to anyone whose
 * is_platform_admin is false, and that is the guard that matters — it is
 * the one an attacker meets. This layout's check is only so a signed-in
 * organiser who guesses the URL gets sent home instead of an empty
 * dashboard full of zeroes and 403s.
 *
 * Not found rather than forbidden: whether platform administration exists
 * is not worth confirming to someone trying the address.
 */

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

// The root layout templates this to "Super admin — EventFlow".
export const metadata = { title: "Super admin" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireToken();

  const { data: me } = await api<{
    user: { full_name: string | null; is_platform_admin?: boolean };
  }>("/me");

  // Fails closed: anything other than a definite yes goes home. This is
  // only so an organiser who guesses the URL gets sent somewhere sensible
  // instead of a dashboard full of 403s — the guard that matters is the
  // API's, which checks the flag on every /admin request of its own accord.
  if (!me.user?.is_platform_admin) redirect("/dashboard");

  return (
    <div className={`${inter.variable} org-root admin-root`}>
      <div className="shell">
        <Suspense fallback={<aside className="side admin-side" />}>
          <AdminSidebar name={me.user?.full_name ?? null} />
        </Suspense>
        <div className="col">
          <main className="main">{children}</main>
        </div>
      </div>
    </div>
  );
}
