"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/org-api";

export async function createEvent(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const startsAt = String(formData.get("starts_at") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  if (!name || !startsAt) redirect("/events?error=missing");

  const { status, data } = await api<{ id: string }>("/events", {
    method: "POST",
    body: {
      name,
      leg: {
        // Single-venue events have one leg and the UI never says the word.
        name: "Ceremony",
        starts_at: new Date(startsAt).toISOString(),
        venue_name: venue || undefined,
      },
    },
  });
  if (status !== 201) redirect("/events?error=create");
  redirect(`/events/${data.id}`);
}

export async function addHousehold(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const name = String(formData.get("display_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const allowance = Number(formData.get("allowance") ?? 1);

  if (!name) redirect(`/events/${eventId}/guests?error=name`);

  const { status } = await api(`/events/${eventId}/invitations`, {
    method: "POST",
    body: {
      display_name: name,
      primary_phone: phone || undefined,
      legs: [{ leg_id: legId, allowance: Math.max(1, allowance) }],
    },
  });
  if (status !== 201) redirect(`/events/${eventId}/guests?error=add`);
  revalidatePath(`/events/${eventId}/guests`);
  redirect(`/events/${eventId}/guests`);
}
