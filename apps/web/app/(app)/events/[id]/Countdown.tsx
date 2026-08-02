"use client";

import { useEffect, useState } from "react";

/**
 * Time until the doors open, ticking.
 *
 * Rendered on the client because it changes every second, and seeded from
 * the server's value so the first paint is already right rather than
 * flashing zeros. After the event it stops counting and says so — a
 * negative countdown is the kind of detail that makes software look
 * abandoned.
 */
export function Countdown({ startsAt }: { startsAt: string }) {
  const target = new Date(startsAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = target - now;

  if (left <= 0) {
    return (
      <p className="sub" style={{ marginTop: 6 }}>
        The doors are open.
      </p>
    );
  }

  const secs = Math.floor(left / 1000);
  const parts = [
    { n: Math.floor(secs / 86400), label: "Days" },
    { n: Math.floor((secs % 86400) / 3600), label: "Hours" },
    { n: Math.floor((secs % 3600) / 60), label: "Mins" },
    { n: secs % 60, label: "Secs" },
  ];

  return (
    <div className="countdown">
      {parts.map((p) => (
        <div key={p.label}>
          <strong>{String(p.n).padStart(2, "0")}</strong>
          <small>{p.label}</small>
        </div>
      ))}
    </div>
  );
}
