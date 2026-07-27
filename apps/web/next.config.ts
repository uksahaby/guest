import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Two dev servers on one checkout fight over `.next` — the symptom is a
   * page that renders current markup while running a stale client bundle,
   * so handlers attach and then nothing re-renders. Set NEXT_DIST_DIR to
   * give a second server its own build directory.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
