"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the check-in screen honest while a gate is running.
 *
 * A poll rather than the SSE stream: this page is a whole dashboard, and
 * re-rendering it from the server every few seconds is both simpler and
 * cheaper than wiring every panel to a socket. Fifteen seconds is slow
 * enough to cost nothing and fast enough that an organiser watching the
 * door sees arrivals appear.
 *
 * Stops while the tab is hidden. A laptop left open on a table should not
 * spend the reception polling.
 */
export function LiveRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<string>("");

  useEffect(() => {
    setAt(new Date().toLocaleTimeString("en-NG", {
      hour: "numeric", minute: "2-digit", hour12: true,
    }));

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Date().toLocaleTimeString("en-NG", {
        hour: "numeric", minute: "2-digit", hour12: true,
      }));
    };
    const t = setInterval(tick, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);

  return (
    <span className="live-stamp">
      {at ? `Last updated: ${at}` : "Live"}
    </span>
  );
}
