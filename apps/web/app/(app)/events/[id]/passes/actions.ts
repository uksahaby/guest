"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/org-api";

/**
 * Make a link for every household that has not got one.
 *
 * There is nothing to "generate" about the QR itself — it is derived from
 * the pass id and the event's signing key, and has existed since the
 * household was imported. What is generated is the link the guest
 * receives, and issuing one is what counts a pass against the plan.
 */
export async function generatePasses(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) redirect("/events");

  const { data: list } = await api<{ data: { id: string; delivery_state: string }[] }>(
    `/events/${eventId}/invitations?status=not_sent&limit=500`,
  );
  const ids = (list?.data ?? []).map((r) => r.id);

  if (ids.length === 0) {
    redirect(`/events/${eventId}/passes?generated=0`);
  }

  const { status, data } = await api<{ code?: string; message?: string }>(
    `/events/${eventId}/delivery-links`,
    { method: "POST", body: { invitation_ids: ids } },
  );

  revalidatePath(`/events/${eventId}/passes`);
  if (status >= 400) {
    redirect(
      `/events/${eventId}/passes?error=${encodeURIComponent(data?.code ?? "failed")}`,
    );
  }
  redirect(`/events/${eventId}/passes?generated=${ids.length}`);
}
