/**
 * Server-side calls to the one backend (apps/api). The guest page never
 * talks to the API from the browser — everything renders on the server.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";

export type PublicLeg = {
  leg_id: string;
  name: string;
  starts_at: string;
  venue_name: string | null;
  address_line: string | null;
  map_url: string | null;
  allowance: number;
  rsvp: "pending" | "attending" | "partial" | "declined";
  rsvp_count: number | null;
  table_name: string | null;
};

export type PublicInvitation = {
  event_name: string;
  note: string | null;
  display_name: string;
  pass_code: string;
  legs: PublicLeg[];
};

export async function getInvitation(
  token: string,
): Promise<PublicInvitation | null> {
  const res = await fetch(
    `${API_URL}/public/invitations/${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function postRsvp(
  token: string,
  legId: string,
  attending: boolean,
  count?: number,
): Promise<Response> {
  return fetch(
    `${API_URL}/public/invitations/${encodeURIComponent(token)}/rsvp`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leg_id: legId,
        attending,
        ...(count !== undefined ? { count } : {}),
      }),
    },
  );
}
