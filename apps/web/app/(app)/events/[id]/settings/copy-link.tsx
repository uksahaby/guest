"use client";

import { useState } from "react";

/**
 * The event link, with a copy button.
 *
 * The link is the thing an organiser sends to a hundred people, so it is
 * shown in full and selectable — the copy button is the convenience, not
 * the only way. It reverts to "Copy" after a moment rather than staying
 * "Copied", which would leave the button lying about the clipboard's
 * current contents.
 */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);

  return (
    <div className="linkrow">
      <input className="field" readOnly value={url} aria-label="Event link" />
      <button
        type="button"
        className="ghost icon"
        aria-label={done ? "Link copied" : "Copy link"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          } catch {
            // Clipboard refused (insecure origin, or the user said no).
            // The input beside this button still holds the link.
          }
        }}
      >
        {done ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 13 4 4L19 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2.5" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </div>
  );
}
