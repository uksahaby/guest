"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/org-api";

export async function saveName(formData: FormData): Promise<void> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!fullName) redirect("/welcome?error=name");

  const { status } = await api("/me", {
    method: "PATCH",
    body: { full_name: fullName },
  });
  if (status !== 200) redirect("/welcome?error=save");

  // Optional on purpose. An organiser who skips it signs in by text, which
  // is what everyone did before passwords existed; one who sets it never
  // waits for an SMS again. Ushers never reach this page — they arrive by
  // invite link and have no password at all.
  if (password) {
    const pw = await api<{ message?: string }>("/auth/password", {
      method: "POST",
      body: { password },
    });
    if (pw.status !== 204) redirect("/welcome?error=password");
  }

  redirect("/dashboard");
}
