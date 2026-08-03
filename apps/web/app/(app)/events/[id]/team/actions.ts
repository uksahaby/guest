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

/**
 * A one-time sign-in link for this usher, to send over WhatsApp.
 *
 * The alternative to an SMS: it costs nothing, needs no provider account,
 * and there is no password for one-day staff to forget. The link comes
 * back once — we only store its hash — so it is carried in the redirect
 * for the page to show and is never readable again.
 */
export async function makeInviteLink(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const assignmentId = String(formData.get("assignment_id") ?? "");

  const { status, data } = await api<{ url?: string }>(
    `/staff/${assignmentId}/invite`,
    { method: "POST" },
  );
  if (status !== 201 || !data.url) back(eventId, legId, "invite_failed");

  revalidatePath(`/events/${eventId}/team`);
  redirect(
    `/events/${eventId}/team?leg=${legId}&invite=${encodeURIComponent(data.url!)}`,
  );
}

/**
 * A named group with a lead and a role.
 *
 * Ushers are already staff_assignments; a team is the grouping an
 * organiser actually thinks and briefs in — "Team Bravo is on the VIP
 * gate" — and it is what they shout across a car park.
 */
export async function addTeam(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const role = String(formData.get("role") ?? "gate_staff");
  const entranceId = String(formData.get("entrance_id") ?? "");

  if (!eventId) redirect("/events");
  if (!name) redirect(`/events/${eventId}/team?error=missing`);

  const { status, data } = await api<{ code?: string }>(
    `/events/${eventId}/teams`,
    {
      method: "POST",
      body: {
        name,
        description: description || undefined,
        role,
        entrance_id: entranceId || undefined,
      },
    },
  );

  revalidatePath(`/events/${eventId}/team`);
  redirect(
    status === 201
      ? `/events/${eventId}/team?added=team`
      : `/events/${eventId}/team?error=${encodeURIComponent(data?.code ?? "failed")}`,
  );
}

/** Note something that happened at a gate, so it is not on someone's hand. */
export async function reportIncident(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const entranceId = String(formData.get("entrance_id") ?? "");

  if (!eventId) redirect("/events");
  if (!note) redirect(`/events/${eventId}/team?error=missing`);

  const { status } = await api(`/events/${eventId}/incidents`, {
    method: "POST",
    body: { note, entrance_id: entranceId || undefined },
  });

  revalidatePath(`/events/${eventId}/team`);
  redirect(
    status === 201
      ? `/events/${eventId}/team?added=incident`
      : `/events/${eventId}/team?error=failed`,
  );
}

export async function resolveIncident(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const incidentId = String(formData.get("incident_id") ?? "");
  if (!eventId || !incidentId) redirect("/events");

  await api(`/incidents/${incidentId}/resolve`, { method: "POST" });
  revalidatePath(`/events/${eventId}/team`);
  redirect(`/events/${eventId}/team?resolved=1`);
}
