"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, callerHeaders } from "@/lib/org-api";

/**
 * Phone plus recovery code, set a new password, come back signed in.
 *
 * The code is spent and replaced by the API, so the new one is shown on
 * the way through — otherwise the next forgotten password has no way out.
 */
export async function recoverAccount(formData: FormData): Promise<void> {
  const phone = String(formData.get("phone") ?? "").trim();
  const recoveryCode = String(formData.get("recovery_code") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const res = await fetch(`${API_URL}/auth/recovery/reset`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await callerHeaders()) },
    body: JSON.stringify({
      phone,
      recovery_code: recoveryCode,
      password,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    redirect(`/recover?error=${body?.code === "bad_password" ? "password" : "code"}`);
  }

  const session = await res.json();
  const jar = await cookies();
  jar.set("jwt", session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 3600,
    path: "/",
  });
  jar.set("recovery_code", String(session.recovery_code ?? ""), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  // Straight to the new code: the one they just used is dead.
  redirect("/welcome/recovery");
}
