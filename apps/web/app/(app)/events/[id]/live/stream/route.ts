import { API_URL, getToken } from "@/lib/org-api";

/**
 * Proxies the API's SSE stream to the browser.
 *
 * EventSource cannot send an Authorization header, and the obvious
 * workaround — putting the JWT in the query string — writes a live
 * credential into browser history, referrer headers and every proxy log
 * between here and the venue. Instead the session stays in its httpOnly
 * cookie, this handler attaches the bearer token server-side, and the
 * upstream body is piped straight through.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const legId = new URL(req.url).searchParams.get("leg");
  if (!legId) {
    return Response.json({ code: "no_leg", message: "Which part of the event?" }, { status: 400 });
  }

  const token = await getToken();
  if (!token) {
    return Response.json({ code: "unauthenticated" }, { status: 401 });
  }

  const upstream = await fetch(`${API_URL}/legs/${legId}/stream`, {
    headers: { authorization: `Bearer ${token}` },
    // When the browser gives up on the stream, let go of the upstream one
    // too rather than holding a subscription for a tab that has gone.
    signal: req.signal,
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { code: "stream_failed", message: "Couldn't open the live feed." },
      { status: upstream.status },
    );
  }
  void id;

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
