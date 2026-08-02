import { API_URL, getToken } from "@/lib/org-api";

/**
 * An event's cover image.
 *
 * Authenticated: this is the organiser's app. Guests see the same picture
 * through their own pass token, on the guest route — there is no route
 * keyed on the event id alone, or anyone could walk ids and collect
 * photographs of couples.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const token = await getToken();
  if (!token) return new Response(null, { status: 401 });

  const upstream = await fetch(
    `${API_URL}/events/${encodeURIComponent(id)}/cover`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!upstream.ok) return new Response(null, { status: upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}
