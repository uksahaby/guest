"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The live check-in view, per the Live tab in
 * mockups/event-workspace.html: four counters, the arrivals feed, and a
 * panel per gate.
 *
 * EventSource handles reconnection itself, so there is no retry loop here
 * — the server sends `retry: 2000`, and a hall with patchy wifi simply
 * picks up where it left off.
 */

type Counters = {
  inside: number;
  confirmed: number;
  still_expected: number;
  arrivals_last_hour: number;
  refused: number;
  overflow_parties: number;
  overflow_people: number;
  invited_people: number;
};

type Gate = {
  id: string;
  name: string;
  admitted: number;
  ushers: string | null;
  last_seen_at: string | null;
};

type FeedItem = {
  id: string;
  result: string;
  admitted_count: number;
  recorded_at: string;
  display_name: string;
  entrance_name: string | null;
  staff_name: string | null;
  allowance: number | null;
  admitted_total: number;
};

const ADMITTING = new Set([
  "admitted", "partial", "manual", "overflow_admitted", "re_entry",
]);

function tone(item: FeedItem): "" | "w" | "e" {
  if (item.result === "overflow_admitted") return "w";
  return ADMITTING.has(item.result) ? "" : "e";
}

/** "3 of 4 admitted", "refused, wrong event" — the mockup's own phrasing. */
function describe(item: FeedItem): string {
  const where = [item.entrance_name, item.staff_name].filter(Boolean).join(" · ");
  let what: string;
  if (ADMITTING.has(item.result)) {
    what =
      item.allowance && item.admitted_total < item.allowance
        ? `${item.admitted_total} of ${item.allowance} admitted`
        : `${item.admitted_count} admitted`;
    if (item.result === "overflow_admitted" && item.allowance) {
      what = `${item.admitted_count} admitted, ${Math.max(
        0,
        item.admitted_total - item.allowance,
      )} over`;
    }
    if (item.result === "manual") what += ", by name";
  } else {
    what = `refused, ${item.result.replaceAll("_", " ")}`;
  }
  return [where, what].filter(Boolean).join(" · ");
}

function clockOf(iso: string) {
  return new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

export default function LiveClient({
  eventId,
  legId,
  initial,
}: {
  eventId: string;
  legId: string;
  initial: { counters: Counters; gates: Gate[]; feed: FeedItem[] };
}) {
  const [counters, setCounters] = useState(initial.counters);
  const [gates, setGates] = useState(initial.gates);
  const [feed, setFeed] = useState<FeedItem[]>(initial.feed);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set(initial.feed.map((f) => f.id)));

  useEffect(() => {
    const source = new EventSource(
      `/events/${eventId}/live/stream?leg=${encodeURIComponent(legId)}`,
    );

    source.addEventListener("snapshot", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        counters: Counters;
        gates: Gate[];
      };
      setCounters(d.counters);
      setGates(d.gates);
      setConnected(true);
    });

    source.addEventListener("check_in", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as {
        item: FeedItem;
        counters: Counters;
        gates: Gate[];
      };
      setCounters(d.counters);
      setGates(d.gates);
      // A reconnect can replay what we already have.
      if (!seen.current.has(d.item.id)) {
        seen.current.add(d.item.id);
        setFeed((f) => [d.item, ...f].slice(0, 50));
      }
    });

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    return () => source.close();
  }, [eventId, legId]);

  return (
    <>
      <p className="sub">
        <span className={`livedot ${connected ? "on" : ""}`} />
        {connected ? "Live — updating as guests arrive" : "Reconnecting…"}
      </p>

      {counters.overflow_parties > 0 && (
        <div className="unassigned">
          <div>
            <div className="t">
              {counters.overflow_parties}{" "}
              {counters.overflow_parties === 1 ? "party" : "parties"} admitted over
              their allowance
            </div>
            <div className="s">
              {counters.overflow_people} extra{" "}
              {counters.overflow_people === 1 ? "person is" : "people are"} inside.
              You invited {counters.invited_people} — {counters.inside} have come.
            </div>
          </div>
        </div>
      )}

      <div className="stats">
        <div className="stat live">
          <div className="n">{counters.inside}</div>
          <div className="l">Inside now · of {counters.confirmed} confirmed</div>
        </div>
        <div className="stat">
          <div className="n">{counters.still_expected}</div>
          <div className="l">Still expected · confirmed, not arrived</div>
        </div>
        <div className="stat">
          <div className="n">{counters.arrivals_last_hour}</div>
          <div className="l">Arrivals last hour</div>
        </div>
        <div className="stat">
          <div className="n">{counters.refused}</div>
          <div className="l">Refused · every one is recorded</div>
        </div>
      </div>

      <div className="livegrid">
        <div className="card" style={{ marginTop: 22 }}>
          <h2>Arrivals</h2>
          {feed.length === 0 ? (
            <div className="empty">
              Nobody has been scanned yet. This fills as the gate opens.
            </div>
          ) : (
            <div className="feed">
              {feed.map((item) => (
                <div className="fitem" key={item.id}>
                  <span className={`fdot ${tone(item)}`} />
                  <div className="fmain">
                    <div className="fname">{item.display_name}</div>
                    <div className="fmeta">{describe(item)}</div>
                  </div>
                  <span className="ftime">{clockOf(item.recorded_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 22 }}>
          <h2>Gates</h2>
          {gates.length === 0 ? (
            <div className="empty">No gates set up yet.</div>
          ) : (
            gates.map((g) => (
              <div className="fitem" key={g.id}>
                <div className="fmain">
                  <div className="fname">{g.name}</div>
                  <div className="fmeta">{g.ushers ?? "No usher assigned"}</div>
                </div>
                <span className="gcount">{g.admitted}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
