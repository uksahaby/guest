"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  addWalkIn,
  searchGuests,
  submitScan,
  type Decision,
  type Guest,
} from "./actions";

/**
 * The gate, in a browser.
 *
 * It decides nothing. Every outcome on this screen came from decide() on
 * the server (HANDOFF §5: decide() exists at most twice, and a third copy
 * in browser JavaScript is exactly what this must not become). The camera
 * reads a string; the server says what it means.
 */

type Props = { legId: string; entranceId: string | null; gateName: string };

/** Repeat suppression: the same code fills many frames a second. */
const SAME_CODE_MS = 3000;

export default function ScannerClient({ legId, entranceId, gateName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ raw: string; at: number }>({ raw: "", at: 0 });
  const busyRef = useRef(false);

  const [cameraState, setCameraState] = useState<
    "starting" | "on" | "denied" | "insecure"
  >("starting");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [pendingRaw, setPendingRaw] = useState<string | null>(null);
  const [pendingPassId, setPendingPassId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);
  const [walkName, setWalkName] = useState("");
  const [walkCount, setWalkCount] = useState(1);
  const [walkDone, setWalkDone] = useState<string | null>(null);

  const send = useCallback(
    async (body: { raw?: string; pass_id?: string; requested_count?: number }) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      try {
        const res = await submitScan(legId, {
          ...body,
          // A fresh id per submission. needs_count writes nothing, so the
          // confirm that follows is genuinely a new event, not a retry.
          client_uuid: crypto.randomUUID(),
          entrance_id: entranceId,
        });
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setDecision(res.decision);
        if (res.decision.outcome === "needs_count") {
          setPendingRaw(body.raw ?? null);
          setPendingPassId(body.pass_id ?? null);
        } else {
          setPendingRaw(null);
          setPendingPassId(null);
        }
      } finally {
        busyRef.current = false;
      }
    },
    [legId, entranceId],
  );

  // ---- camera ------------------------------------------------------------

  useEffect(() => {
    // getUserMedia only exists in a secure context. A staging box served
    // over plain HTTP, or reached by LAN IP, has no camera API at all —
    // and the browser gives no hint why, so say it here.
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("insecure");
      return;
    }

    let stream: MediaStream | null = null;
    let stop = false;

    // BarcodeDetector where it exists (Chrome on Android — the common case,
    // and hardware-accelerated), jsQR everywhere else. Safari has no
    // BarcodeDetector at all, and half the casual staff this page exists
    // for are carrying iPhones, so "install Chrome" is not an answer.
    const Detector = (
      globalThis as unknown as { BarcodeDetector?: new (o: object) => object }
    ).BarcodeDetector;

    const native = Detector
      ? (new Detector({ formats: ["qr_code"] }) as {
          detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
        })
      : null;

    // jsQR reads pixels, so the frame goes through a canvas first. Sized
    // down to 480px on its long edge: a QR that fills the reticle decodes
    // fine at that, and full resolution costs more than it buys on a
    // mid-range phone doing this every frame.
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const readFrame = async (video: HTMLVideoElement): Promise<string | null> => {
      if (native) {
        const found = await native.detect(video);
        return found[0]?.rawValue ?? null;
      }
      if (!ctx) return null;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 480 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(data.data, data.width, data.height, {
        inversionAttempts: "dontInvert",
      })?.data ?? null;
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stop) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState("on");
      } catch {
        setCameraState("denied");
        return;
      }

      const tick = async () => {
        if (stop) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && !busyRef.current) {
          try {
            const raw = await readFrame(video);
            const now = Date.now();
            const last = lastRef.current;
            if (raw && !(raw === last.raw && now - last.at < SAME_CODE_MS)) {
              lastRef.current = { raw, at: now };
              await send({ raw });
            }
          } catch {
            // A frame that will not decode is the normal case, not an error.
          }
        }
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })();

    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [send]);

  // ---- search ------------------------------------------------------------

  useEffect(() => {
    if (!searchOpen) return;
    const q = query;
    const t = setTimeout(async () => setGuests(await searchGuests(legId, q)), 200);
    return () => clearTimeout(t);
  }, [query, searchOpen, legId]);

  const confirmCount = (n: number) =>
    send({
      ...(pendingPassId ? { pass_id: pendingPassId } : { raw: pendingRaw ?? "" }),
      requested_count: n,
    });

  const dismiss = () => {
    setDecision(null);
    setPendingRaw(null);
    setPendingPassId(null);
  };

  const submitWalkIn = async () => {
    if (busyRef.current || !walkName.trim()) return;
    busyRef.current = true;
    setError(null);
    try {
      const res = await addWalkIn(legId, {
        client_uuid: crypto.randomUUID(),
        display_name: walkName.trim(),
        count: walkCount,
        entrance_id: entranceId,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setWalkDone(`${res.displayName} · ${res.admitted} admitted`);
      setWalkOpen(false);
      setWalkName("");
      setWalkCount(1);
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <main className="scan-gate">
      <header className="scan-bar">
        <span className="scan-gate-name">{gateName}</span>
        <a className="scan-back" href="/scan">
          Change gate
        </a>
      </header>

      <div className="scan-view">
        {cameraState === "on" || cameraState === "starting" ? (
          <>
            <video ref={videoRef} className="scan-video" muted playsInline />
            <div className="scan-reticle" aria-hidden="true" />
            <p className="scan-hint">Point at the guest&rsquo;s pass</p>
          </>
        ) : (
          <div className="scan-nocam">
            <p className="scan-nocam-t">
              {cameraState === "denied"
                ? "No camera access"
                : "Camera needs a secure connection"}
            </p>
            <p className="scan-nocam-s">
              {cameraState === "denied"
                ? "Allow the camera in your browser settings, then reload. You can still find guests by name below."
                : "Browsers only allow the camera over https. Open this page on its https address — or find guests by name below."}
            </p>
          </div>
        )}
      </div>

      {error && <p className="scan-error">{error}</p>}

      <div className="scan-actions">
        <button
          className="scan-btn"
          type="button"
          onClick={() => {
            setSearchOpen((v) => !v);
            setWalkOpen(false);
            setGuests([]);
            setQuery("");
          }}
        >
          {searchOpen ? "Close search" : "Search by name"}
        </button>
        <button
          className="scan-btn"
          type="button"
          onClick={() => {
            setWalkOpen((v) => !v);
            setSearchOpen(false);
            setWalkDone(null);
          }}
        >
          {walkOpen ? "Cancel walk-in" : "Add walk-in"}
        </button>
      </div>

      {walkDone && <p className="scan-walkdone">Walked in — {walkDone}</p>}

      {walkOpen && (
        <div className="scan-search">
          <input
            className="scan-input"
            placeholder="Name, as you would read it off a card"
            value={walkName}
            onChange={(e) => setWalkName(e.target.value)}
            maxLength={200}
            autoFocus
          />
          <p className="scan-ask">How many?</p>
          <div className="scan-counts">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                className={`scan-count${walkCount === n ? "" : " ghost"}`}
                type="button"
                onClick={() => setWalkCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            className="scan-btn scan-walkgo"
            type="button"
            disabled={!walkName.trim()}
            onClick={submitWalkIn}
          >
            Admit {walkCount}
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="scan-search">
          <input
            className="scan-input"
            placeholder="Name or last 4 digits"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <ul className="scan-results">
            {guests.map((g) => (
              <li key={g.pass_id}>
                <button
                  className="scan-result"
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    send({ pass_id: g.pass_id });
                  }}
                >
                  <span className="scan-result-name">{g.display_name}</span>
                  <span className="scan-result-sub">
                    {[g.category, `Party of ${g.allowance}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="scan-result-count">
                    {g.admitted} of {g.allowance}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision && (
        <Result
          decision={decision}
          onCount={confirmCount}
          onDismiss={dismiss}
        />
      )}
    </main>
  );
}

function Result({
  decision: d,
  onCount,
  onDismiss,
}: {
  decision: Decision;
  onCount: (n: number) => void;
  onDismiss: () => void;
}) {
  const choices = d.choices ?? [];
  // decide() already puts the household somewhere in every result — as the
  // headline on the count prompt, inside detail on an admit. Repeating it
  // stutters on the one screen that has to be read in a glance, so each
  // line is shown only when it is not already on screen.
  const name = d.invitation?.displayName;
  const who =
    d.invitation && name && !d.headline.includes(name)
      ? [name, d.invitation.tableName].filter(Boolean).join(" · ")
      : null;
  const detail =
    d.detail && d.detail !== who && d.detail !== d.headline ? d.detail : null;

  return (
    <div className={`scan-result-panel tone-${d.tone}`} role="status">
      <p className="scan-outcome">{d.headline}</p>
      {who && <p className="scan-who">{who}</p>}
      {detail && <p className="scan-detail">{detail}</p>}

      {d.outcome === "needs_count" && choices.length > 0 && (
        <>
          <p className="scan-ask">How many arrived?</p>
          <div className="scan-counts">
            {choices.map((n) => (
              <button
                key={n}
                className="scan-count"
                type="button"
                onClick={() => onCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      <button className="scan-dismiss" type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
