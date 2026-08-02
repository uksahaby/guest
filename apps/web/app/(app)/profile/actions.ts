"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, getToken, API_URL } from "@/lib/org-api";

/**
 * Upload a profile photo.
 *
 * The file is streamed to the API as multipart rather than read into a
 * string here: a 2 MB image base64-encoded through JSON is 2.7 MB of
 * memory on a server that has better things to hold.
 */
export async function uploadAvatar(formData: FormData): Promise<void> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/profile?error=no_file");
  }

  const token = await getToken();
  if (!token) redirect("/login");

  const body = new FormData();
  body.set("file", file, file.name || "photo");

  const res = await fetch(`${API_URL}/me/avatar`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });

  if (!res.ok) {
    const problem = await res.json().catch(() => ({ code: "failed" }));
    redirect(`/profile?error=${encodeURIComponent(problem.code ?? "failed")}`);
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  redirect("/profile?saved=1");
}

export async function removeAvatar(): Promise<void> {
  const token = await getToken();
  if (!token) redirect("/login");
  await fetch(`${API_URL}/me/avatar`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  redirect("/profile?saved=1");
}

/** Name and email, the two things an organiser can correct about herself. */
export async function saveProfile(formData: FormData): Promise<void> {
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  const { status } = await api("/me", {
    method: "PATCH",
    body: { full_name, email: email || null },
  });

  revalidatePath("/profile");
  redirect(status < 400 ? "/profile?saved=1" : "/profile?error=save");
}
