import Link from "next/link";
import { api } from "@/lib/org-api";

type Assignment = {
  leg_id: string;
  leg_name: string;
  event_name: string;
  entrance_id: string | null;
  guest_count: number;
  is_open: boolean;
};

/** "Which gate?" — the same list the app shows, one tap from scanning. */
export default async function ScanIndex() {
  const { data } = await api<Assignment[]>("/scanner/assignments");
  const assignments = data ?? [];

  return (
    <main className="scan-wrap">
      <h1 className="scan-h1">Which gate?</h1>

      {assignments.length === 0 ? (
        <p className="scan-empty">
          You are not on any gate yet. The organiser adds you from the event&rsquo;s
          Team page.
        </p>
      ) : (
        <ul className="scan-list">
          {assignments.map((a) => (
            <li key={a.leg_id}>
              <Link className="scan-card" href={`/scan/${a.leg_id}`}>
                <span className="scan-card-name">{a.event_name}</span>
                <span className="scan-card-sub">
                  {a.leg_name} · {a.guest_count} households
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="scan-note">
        This page needs a connection to work. The app keeps scanning when the
        signal goes — if you are working a whole event, install it.
      </p>
    </main>
  );
}
