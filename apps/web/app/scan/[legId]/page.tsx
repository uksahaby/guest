import { notFound } from "next/navigation";
import { api } from "@/lib/org-api";
import ScannerClient from "./scanner-client";

type Assignment = {
  leg_id: string;
  leg_name: string;
  event_name: string;
  entrance_id: string | null;
};

export default async function ScanGate({
  params,
}: {
  params: Promise<{ legId: string }>;
}) {
  const { legId } = await params;

  // The assignment list is also the authorisation check: an usher who is
  // not on this leg has no row here, and the scan endpoint would refuse
  // them anyway.
  const { data } = await api<Assignment[]>("/scanner/assignments");
  const mine = (data ?? []).find((a) => a.leg_id === legId);
  if (!mine) notFound();

  return (
    <ScannerClient
      legId={legId}
      entranceId={mine.entrance_id}
      gateName={`${mine.event_name} · ${mine.leg_name}`}
    />
  );
}
