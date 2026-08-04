"use server";

import { cookies } from "next/headers";
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

/**
 * Mint a recovery code and show it once.
 *
 * The endpoint has existed since recovery was built; nothing ever called
 * it. A code was only ever created by signing up or by completing a reset,
 * so anyone whose account arrived another way — seeded, or created by an
 * organiser, or signed in by OTP and given a password later — had no
 * recovery code at all and no way to get one. With SMS optional and no
 * email channel, that left a human with database access as the only way
 * back in. This closes that.
 *
 * Replacing any existing code is the point rather than a side effect: two
 * live codes would be two live keys to the same account.
 */
export async function mintRecoveryCode(): Promise<void> {
  const { status, data } = await api<{ recovery_code?: string }>(
    "/auth/recovery-code",
    { method: "POST" },
  );
  if (status !== 200 || !data?.recovery_code) {
    redirect("/profile?error=recovery");
  }

  // Same route the signup flow uses: a short-lived httpOnly cookie rather
  // than the URL, so the code stays out of browser history and out of any
  // log that records query strings. /welcome/recovery shows it once and
  // deletes the cookie.
  (await cookies()).set("recovery_code", data.recovery_code, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  redirect("/welcome/recovery");
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
