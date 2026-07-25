"use server";

import { redirect } from "next/navigation";
import { postRsvp } from "./api";

/**
 * The RSVP reply. A plain form post — works with JavaScript disabled,
 * which on Nigerian mobile data is not a hypothetical.
 */
export async function reply(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const count = Number(formData.get("count") ?? 0);

  if (!token || !legId) redirect("/");

  if (intent === "decline") {
    await postRsvp(token, legId, false);
    redirect(`/i/${encodeURIComponent(token)}?replied=1`);
  }

  await postRsvp(token, legId, true, count >= 1 ? count : undefined);
  redirect(`/i/${encodeURIComponent(token)}?replied=1`);
}

/** "Change my reply" — just re-shows the form. */
export async function reopen(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  redirect(`/i/${encodeURIComponent(token)}?change=1`);
}
