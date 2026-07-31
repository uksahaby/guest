"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, callerHeaders } from "@/lib/org-api";

/**
 * Spends the invite and signs the usher in.
 *
 * Deliberately a POST behind a button rather than something that happens
 * on page load: WhatsApp fetches URLs to build link previews, and a
 * one-time link consumed on GET would be spent by the preview bot before
 * the usher ever tapped it.
 */
export async function acceptInvite(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/join/invalid");

  const res = await fetch(
    `${API_URL}/public/staff-invites/${encodeURIComponent(token)}/accept`,
    { method: "POST", cache: "no-store", headers: await callerHeaders() },
  );

  if (!res.ok) redirect(`/join/${encodeURIComponent(token)}?error=1`);

  const session = await res.json();
  const jar = await cookies();
  jar.set("jwt", session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 3600,
    path: "/",
  });

  // Straight to the gate they were invited to, not a list of one.
  redirect(session.leg_id ? `/scan/${session.leg_id}` : "/scan");
}
