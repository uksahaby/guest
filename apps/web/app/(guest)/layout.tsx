import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./guest.css";

/**
 * Guest surface — elegant, celebratory, emotion first (HANDOFF §7).
 *
 * Server components with near-zero client JS: this page loads on a
 * mid-range Android on Nigerian mobile data and is the first thing 500
 * strangers see. No component library here by design.
 *
 * Cormorant Garamond, not Playfair — the reflexive wedding choice reads
 * as templated.
 */

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "You're invited",
  robots: { index: false }, // a household's page is theirs alone
};

export const viewport: Viewport = {
  themeColor: "#14300F",
  width: "device-width",
  initialScale: 1,
};

export default function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${cormorant.variable} ${inter.variable} guest-root`}>
      {children}
    </div>
  );
}
