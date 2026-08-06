"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, callerHeaders } from "@/lib/org-api";

/**
 * Two-step OTP sign-in. The phone number travels in an httpOnly cookie
 * between steps — personal data never lands in a URL.
 */

export async function requestCode(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  const res = await fetch(`${API_URL}/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await callerHeaders()) },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();

  if (!res.ok && res.status !== 429) {
    // 502 means the SMS provider refused or was unreachable. The API has
    // already dropped the code, so "try again" is honest advice — there is
    // nothing throttling an immediate retry.
    const kind =
      res.status === 400 ? "phone" : res.status === 502 ? "sms" : "unknown";
    redirect(`/login?error=${kind}`);
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
    headers: { "content-type": "application/json", ...(await callerHeaders()) },
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

  // Sign-in is phone-only, so a first-time user has no name and nothing
  // else will ever ask. Do it before /events: the implicit workspace is
  // named from full_name when the first event is created.
  if (!String(session.user?.full_name ?? "").trim()) redirect("/welcome");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete("jwt");
  redirect("/login");
}

/**
 * Phone and password, for organisers who set one. OTP stays available and
 * is the way back in when a password is forgotten — which is why the login
 * page offers both rather than replacing one with the other.
 */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // The Admin tab is the same credentials through the same endpoint. What
  // it changes is where you land and what you are told when the account is
  // not an administrator — signing somebody in and dropping them on the
  // organiser dashboard, when they asked for the platform, looks like a
  // bug rather than an answer.
  const wantsAdmin = formData.get("as") === "admin";
  const back = wantsAdmin ? "/login?as=admin" : "/login";

  const res = await fetch(`${API_URL}/auth/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await callerHeaders()) },
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) {
    // 429 is its own answer: "wrong password" would send someone hunting
    // for a password that is fine.
    redirect(`${back}&error=${res.status === 429 ? "throttled" : "password"}`);
  }

  const session = await res.json();
  const jar = await cookies();
  jar.set("jwt", session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 3600,
    path: "/",
  });

  if (wantsAdmin && !session.user?.is_platform_admin) {
    // Signed in, but through the wrong door. The session stands — they are
    // a real organiser — and the page says so.
    redirect("/login?as=admin&error=not_admin&signed_in=1");
  }

  if (!String(session.user?.full_name ?? "").trim()) redirect("/welcome");
  redirect(wantsAdmin ? "/admin" : "/dashboard");
}
