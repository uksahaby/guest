import type { Metadata } from "next";
import { Cormorant_Garamond, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The wordmark is set in Cormorant Garamond (app/brand.tsx), and the brand
 * appears on pages that have no layout of their own — /recover, /welcome,
 * /join. Declared once here so every surface has it rather than four
 * layouts each remembering to.
 */
const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  // create-next-app's default shipped as far as the sign-in page, where
  // the browser tab read "Create Next App" to anybody deciding whether to
  // trust us with their wedding.
  title: { default: "EventFlow", template: "%s — EventFlow" },
  description:
    "Guest lists, invitations and entry for Nigerian weddings and everything larger.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
