import { Inter } from "next/font/google";
import { requireToken } from "@/lib/org-api";
import "../(app)/org.css";
import "./scan.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const metadata = { title: "Check in" };

/**
 * The web scanner — for the usher who turns up on the day having installed
 * nothing (HANDOFF: "two days that saves an event").
 *
 * Deliberately outside the organiser shell: an usher is not an organiser,
 * and the last thing someone working a gate needs is a sidebar of things
 * they cannot do. Dark, full-bleed, one job.
 */
export default async function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireToken(); // no session → /login

  return <div className={`${inter.variable} scan-root`}>{children}</div>;
}
