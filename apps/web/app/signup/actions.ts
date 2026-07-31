"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, callerHeaders } from "@/lib/org-api";

/**
 * Create an organiser account. No code to wait for and nothing to pay a
 * messaging provider for — the phone number is the identifier, and the
 * password is the credential.
 */
export async function createAccount(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  const res = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await callerHeaders()) },
    body: JSON.stringify({ phone, password, full_name: fullName }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const kind =
      body?.code === "phone_taken"
        ? "taken"
        : body?.code === "bad_password"
          ? "password"
          : body?.code === "bad_name"
            ? "name"
            : "phone";
    redirect(`/signup?error=${kind}`);
  }

  const session = await res.json();
  const jar = await cookies();
  jar.set("jwt", session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 3600,
    path: "/",
  });

  // The recovery code is shown once and never again. It travels in a
  // short-lived httpOnly cookie rather than the URL, so it stays out of
  // browser history and out of any server log that records query strings.
  jar.set("recovery_code", String(session.recovery_code ?? ""), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  redirect("/welcome/recovery");
}
