import { getToken, API_URL } from "@/lib/org-api";

/**
 * The signed-in organiser's photo, for an <img src>.
 *
 * A proxy because the API is not reachable from a browser — it lives on a
 * private address and its credential is an httpOnly cookie the page cannot
 * read. So the image is fetched server-side with the session and streamed
 * back on this origin.
 */
export async function GET(): Promise<Response> {
  const token = await getToken();
  if (!token) return new Response(null, { status: 401 });

  const upstream = await fetch(`${API_URL}/me/avatar`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!upstream.ok) return new Response(null, { status: upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}
