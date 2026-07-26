"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/org-api";

export async function saveName(formData: FormData): Promise<void> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) redirect("/welcome?error=name");

  const { status } = await api("/me", {
    method: "PATCH",
    body: { full_name: fullName },
  });
  if (status !== 200) redirect("/welcome?error=save");

  redirect("/events");
}
