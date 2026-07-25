import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape } from "@/lib/org-api";
import ImportClient from "./import-client";

/**
 * "Import guests — a spreadsheet of households. One row per invitation,
 * not per person." The interactive part is a client component so the
 * chosen file survives from preview to commit.
 */
export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { status, data: event } = await api<EventShape>(`/events/${id}`);
  if (status !== 200) notFound();

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}/guests`} style={{ color: "inherit" }}>
          {event.name} · Guests
        </Link>
      </p>
      <h1 className="page">Import guests</h1>
      <p className="sub">
        A spreadsheet of households. One row per invitation, not per person —
        &ldquo;Mr &amp; Mrs Adeyemi, 4&rdquo; is one row. Building a list is
        free on every plan, whatever its size.
      </p>

      <ImportClient eventId={id} />
    </>
  );
}
