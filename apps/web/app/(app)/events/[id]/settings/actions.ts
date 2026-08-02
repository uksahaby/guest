"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, getToken, API_URL } from "@/lib/org-api";

/**
 * Settings actions. Each toggle is its own form, so a change saves on the
 * spot and nothing else in the page can be altered by accident — a
 * settings screen with one big Save button is how people change a gate
 * policy they never meant to touch.
 */

function back(eventId: string, ok: boolean, what?: string): never {
  revalidatePath(`/events/${eventId}/settings`);
  redirect(
    `/events/${eventId}/settings${ok ? (what ? `?saved=${what}` : "") : "?error=1"}`,
  );
}

export async function updateEvent(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const field = String(formData.get("field") ?? "");
  const raw = formData.get("value");

  // Text and date fields post `value`; toggles post `on` only when ticked,
  // so its absence is a genuine "false" rather than a missing field.
  const body: Record<string, unknown> =
    field === "rsvp_deadline"
      ? { rsvp_deadline: String(raw ?? "") || null }
      : field === "manager_phone"
        ? { manager_phone: String(raw ?? "").trim() || null }
        : field === "name"
          ? { name: String(raw ?? "") }
          : field === "status"
            ? { status: String(raw ?? "") }
            : { [field]: formData.get("on") === "on" };

  const { status } = await api(`/events/${eventId}`, { method: "PATCH", body });
  back(eventId, status === 200, field);
}

export async function updateLeg(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const startsAt = String(formData.get("starts_at") ?? "");

  const { status } = await api(`/legs/${legId}`, {
    method: "PATCH",
    body: {
      ...(String(formData.get("name") ?? "").trim()
        ? { name: String(formData.get("name")) }
        : {}),
      ...(startsAt ? { starts_at: new Date(startsAt).toISOString() } : {}),
      venue_name: String(formData.get("venue_name") ?? "") || null,
      address_line: String(formData.get("address_line") ?? "") || null,
      city: String(formData.get("city") ?? "") || null,
    },
  });
  back(eventId, status === 200, "basics");
}

export async function reissuePasses(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  // Typing the word is the confirmation — a dialog would be a client
  // component for something the user should have to stop and read.
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "REISSUE") {
    back(eventId, false);
  }
  const { status } = await api(`/events/${eventId}/reissue-passes`, { method: "POST" });
  back(eventId, status === 200, "reissued");
}

export async function cancelEvent(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const { status } = await api(`/events/${eventId}`, {
    method: "PATCH",
    body: { status: "cancelled" },
  });
  back(eventId, status === 200, "cancelled");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    back(eventId, false);
  }
  const { status } = await api(`/events/${eventId}`, { method: "DELETE" });
  if (status !== 204) back(eventId, false);
  revalidatePath("/events");
  redirect("/events?deleted=1");
}

/**
 * The event's cover photo — the picture of the couple that appears on the
 * dashboard, the overview and the guest's own invitation page.
 *
 * Streamed as multipart rather than JSON: a 2 MB image base64-encoded is
 * 2.7 MB of memory held for no reason.
 */
export async function uploadCover(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const file = formData.get("cover");

  if (!eventId) redirect("/events");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/events/${eventId}/settings?error=no_file`);
  }

  const token = await getToken();
  if (!token) redirect("/login");

  const body = new FormData();
  body.set("file", file, file.name || "cover");

  const res = await fetch(`${API_URL}/events/${eventId}/cover`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });

  if (!res.ok) {
    const problem = await res.json().catch(() => ({ code: "failed" }));
    redirect(
      `/events/${eventId}/settings?error=${encodeURIComponent(problem.code ?? "failed")}`,
    );
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/settings`);
  revalidatePath("/dashboard");
  redirect(`/events/${eventId}/settings?saved=1`);
}
