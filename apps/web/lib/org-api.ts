import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Organiser-side calls to the one backend. The JWT lives in an httpOnly
 * cookie; every call happens on the server. No token ever reaches the
 * browser.
 */

export const API_URL = process.env.API_URL ?? "http://localhost:3001";

/**
 * Pass the caller's address through to the API.
 *
 * Nothing here runs in the browser — every call to the API is made by this
 * server. So as far as the API is concerned all of our traffic, from every
 * guest and every organiser, comes from one address. Its per-IP rate
 * limits would be one shared bucket, and the first person to trip it would
 * lock out everyone else.
 *
 * Forwarding the chain our own host set restores the real caller. The API
 * only believes it when TRUST_PROXY is set there (apps/api/src/env.ts), so
 * a local run with neither configured behaves exactly as before.
 */
export async function callerHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const chain = h.get("x-forwarded-for");
  return chain ? { "x-forwarded-for": chain } : {};
}

export async function getToken(): Promise<string | null> {
  return (await cookies()).get("jwt")?.value ?? null;
}

export async function requireToken(): Promise<string> {
  const token = await getToken();
  if (!token) redirect("/login");
  return token;
}

export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown; token?: string },
): Promise<{ status: number; data: T }> {
  const token = init?.token ?? (await getToken());
  const res = await fetch(`${API_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(await callerHeaders()),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  // /logout, not /login: the cookie is still set and still refused, and
  // /login bounces anyone holding a cookie back to the dashboard — which
  // is a loop, not a login page. Only a route handler can delete it.
  if (res.status === 401) redirect("/logout");
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data: data as T };
}

// ---- shapes the pages use -------------------------------------------------

export type Leg = {
  id: string;
  name: string;
  sequence: number;
  starts_at: string;
  venue_name: string | null;
  city: string | null;
};

export type EventShape = {
  id: string;
  name: string;
  event_type: string;
  status: string;
  plan: string;
  people_limit: number;
  legs: Leg[];
};

export type InvitationRow = {
  id: string;
  display_name: string;
  primary_phone: string | null;
  category: string | null;
  named_count: number;
  delivery_state: "not_sent" | "link_generated" | "sent" | "opened";
  legs: {
    leg_id: string;
    allowance: number;
    rsvp: "pending" | "attending" | "partial" | "declined";
    rsvp_count: number | null;
    table_name: string | null;
    admitted: number;
    remaining: number;
  }[];
};

export type Attendance = {
  invitations: number;
  invited_people: number;
  confirmed_people: number;
  arrived_people: number;
  overflow_parties: number;
  refused: number;
};

export type DeliveryLink = {
  invitation_id: string;
  display_name: string;
  whatsapp_url: string | null;
  invite_url: string;
  message: string;
};
