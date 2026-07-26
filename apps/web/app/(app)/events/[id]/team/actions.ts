"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/org-api";

function back(eventId: string, legId: string, error?: string): never {
  revalidatePath(`/events/${eventId}/team`);
  redirect(
    `/events/${eventId}/team?leg=${legId}${error ? `&error=${error}` : "&saved=1"}`,
  );
}

export async function addGate(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  const { status, data } = await api<{ code?: string }>(`/legs/${legId}/entrances`, {
    method: "POST",
    body: { name },
  });
  back(eventId, legId, status === 201 ? undefined : (data.code ?? "failed"));
}

export async function updateGate(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const entranceId = String(formData.get("entrance_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  const { status, data } = await api<{ code?: string }>(`/entrances/${entranceId}`, {
    method: "PATCH",
    body: {
      ...(name ? { name } : {}),
      is_active: formData.get("is_active") === "on",
    },
  });
  back(eventId, legId, status === 200 ? undefined : (data.code ?? "failed"));
}

export async function removeGate(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const entranceId = String(formData.get("entrance_id") ?? "");

  const { status, data } = await api<{ code?: string }>(`/entrances/${entranceId}`, {
    method: "DELETE",
  });
  back(eventId, legId, status === 204 ? undefined : (data?.code ?? "failed"));
}

export async function inviteUsher(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const entrance = String(formData.get("entrance_id") ?? "");

  const { status, data } = await api<{ code?: string }>(`/legs/${legId}/staff`, {
    method: "POST",
    body: {
      phone: String(formData.get("phone") ?? ""),
      full_name: String(formData.get("full_name") ?? "").trim() || undefined,
      role: String(formData.get("role") ?? "usher"),
      entrance_id: entrance || null,
      can_walk_in: formData.get("can_walk_in") === "on",
      can_override: formData.get("can_override") === "on",
      can_manual: true,
    },
  });
  back(eventId, legId, status === 201 ? undefined : (data.code ?? "failed"));
}

export async function updateStaff(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const entrance = String(formData.get("entrance_id") ?? "");

  const { status, data } = await api<{ code?: string }>(`/staff/${assignmentId}`, {
    method: "PATCH",
    body: {
      entrance_id: entrance || null,
      can_walk_in: formData.get("can_walk_in") === "on",
      can_override: formData.get("can_override") === "on",
    },
  });
  back(eventId, legId, status === 200 ? undefined : (data.code ?? "failed"));
}

export async function removeStaff(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const assignmentId = String(formData.get("assignment_id") ?? "");

  const { status } = await api(`/staff/${assignmentId}`, { method: "DELETE" });
  back(eventId, legId, status === 204 ? undefined : "failed");
}
