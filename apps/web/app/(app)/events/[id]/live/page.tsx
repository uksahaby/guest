import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import LiveClient from "./live-client";

/**
 * Live check-in. Rendered once on the server so the page is useful before
 * a single byte of the stream arrives — then the client component takes
 * over and keeps it moving.
 */
export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ leg?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  const leg = event.legs.find((l) => l.id === sp.leg) ?? event.legs[0];
  if (!leg) notFound();

  const { data: initial } = await api<Parameters<typeof LiveClient>[0]["initial"]>(
    `/legs/${leg.id}/live`,
  );

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}`} style={{ color: "inherit" }}>
          {event.name}
        </Link>
      </p>
      <h1 className="page">Check-in</h1>

      {event.legs.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {event.legs.map((l) => (
            <Link
              key={l.id}
              className={l.id === leg.id ? "primary" : "ghost"}
              href={`/events/${id}/live?leg=${l.id}`}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}

      <LiveClient eventId={id} legId={leg.id} initial={initial} />
    </>
  );
}
