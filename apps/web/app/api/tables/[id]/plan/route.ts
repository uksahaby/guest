import { getToken, API_URL } from "@/lib/org-api";

/**
 * Where a table sits on the plan, saved after a drag.
 *
 * A proxy: the floor plan runs in the browser and the API is not reachable
 * from there — private address, httpOnly session. The drag posts here and
 * this forwards it with the organiser's token.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const token = await getToken();
  if (!token) return new Response(null, { status: 401 });

  const { id } = await ctx.params;
  const upstream = await fetch(
    `${API_URL}/tables/${encodeURIComponent(id)}/plan`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: await req.text(),
    },
  );
  return new Response(null, { status: upstream.status });
}
