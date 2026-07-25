"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/org-api";

/**
 * Starts a payment. The browser only names a plan — the API prices it, and
 * nothing about the event changes until Paystack's signed webhook arrives.
 */
export async function startCheckout(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const email = String(formData.get("email") ?? "").trim();

  const { status, data } = await api<{
    authorization_url?: string;
    code?: string;
    message?: string;
  }>(`/events/${eventId}/checkout`, {
    method: "POST",
    body: { plan, ...(email ? { email } : {}) },
  });

  if (status === 200 && data.authorization_url) {
    // Off to Paystack's hosted page — we never handle card details.
    redirect(data.authorization_url);
  }
  redirect(`/events/${eventId}/billing?error=${data.code ?? "failed"}`);
}
