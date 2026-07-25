import { API_URL, getToken } from "@/lib/org-api";

/**
 * Proxies an import upload to the API.
 *
 * The session is an httpOnly cookie on this origin, so the browser cannot
 * call the API directly — this handler attaches the token server-side. The
 * body is forwarded byte for byte so the multipart boundary survives.
 *
 * Both steps of the import come through here: `dry_run=true` for the
 * preview, and the same file again to commit. The browser holds the File
 * in memory between the two, so the organiser only ever picks it once.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const token = await getToken();
  if (!token) {
    return Response.json(
      { code: "unauthenticated", message: "Your session has expired — sign in again." },
      { status: 401 },
    );
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data")) {
    return Response.json(
      { code: "expected_multipart", message: "Send the file as multipart/form-data." },
      { status: 415 },
    );
  }

  const upstream = await fetch(`${API_URL}/events/${id}/invitations/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    body: await req.arrayBuffer(),
    cache: "no-store",
  });

  return Response.json(await upstream.json(), { status: upstream.status });
}
