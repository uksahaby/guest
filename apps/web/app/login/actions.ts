"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/org-api";

/**
 * Two-step OTP sign-in. The phone number travels in an httpOnly cookie
 * between steps — personal data never lands in a URL.
 */

export async function requestCode(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  const res = await fetch(`${API_URL}/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();

  if (!res.ok && res.status !== 429) {
    redirect(`/login?error=${res.status === 400 ? "phone" : "unknown"}`);
  }

  const jar = await cookies();
  jar.set("login_phone", phone, { httpOnly: true, maxAge: 600, path: "/login" });
  if (data?.dev_code) {
    // Dev servers surface the code so the flow is testable end to end.
    jar.set("login_hint", String(data.dev_code), {
      httpOnly: true,
      maxAge: 600,
      path: "/login",
    });
  }
  redirect("/login?step=code");
}

export async function verifyCode(formData: FormData): Promise<void> {
  const jar = await cookies();
  const phone = jar.get("login_phone")?.value;
  const code = String(formData.get("code") ?? "").trim();
  if (!phone) redirect("/login");

  const res = await fetch(`${API_URL}/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) redirect("/login?step=code&error=code");

  const session = await res.json();
  jar.set("jwt", session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 3600,
    path: "/",
  });
  jar.delete("login_phone");
  jar.delete("login_hint");
  redirect("/events");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete("jwt");
  redirect("/login");
}
