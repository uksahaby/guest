"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/org-api";

/**
 * Seating actions. Plain form posts — the seating page is a table of
 * selects and buttons, not a drag-and-drop canvas, so there is nothing
 * here that needs client JS.
 */

function back(eventId: string, error?: string): never {
  revalidatePath(`/events/${eventId}/tables`);
  redirect(`/events/${eventId}/tables${error ? `?error=${error}` : ""}`);
}

export async function addTables(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const count = Number(formData.get("count") ?? 0);
  const capacity = Number(formData.get("capacity") ?? 10);

  const body = name
    ? { name, capacity }
    : { count: Math.max(1, count), capacity, prefix: "Table" };

  const { status, data } = await api<{ code?: string }>(`/legs/${legId}/tables`, {
    method: "POST",
    body,
  });
  back(eventId, status === 201 ? undefined : (data.code ?? "failed"));
}

export async function seatHousehold(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const invitationId = String(formData.get("invitation_id") ?? "");
  const raw = String(formData.get("table_id") ?? "");

  const { status, data } = await api<{ code?: string }>(
    `/invitations/${invitationId}/legs/${legId}`,
    { method: "PUT", body: { table_id: raw === "" ? null : raw } },
  );
  back(eventId, status === 200 ? undefined : (data.code ?? "failed"));
}

export async function renameTable(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const tableId = String(formData.get("table_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const capacity = Number(formData.get("capacity") ?? 0);

  const { status, data } = await api<{ code?: string }>(`/tables/${tableId}`, {
    method: "PATCH",
    body: {
      ...(name ? { name } : {}),
      ...(Number.isInteger(capacity) && capacity > 0 ? { capacity } : {}),
    },
  });
  back(eventId, status === 200 ? undefined : (data.code ?? "failed"));
}

export async function removeTable(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const tableId = String(formData.get("table_id") ?? "");
  const { status } = await api(`/tables/${tableId}`, { method: "DELETE" });
  back(eventId, status === 204 ? undefined : "failed");
}
