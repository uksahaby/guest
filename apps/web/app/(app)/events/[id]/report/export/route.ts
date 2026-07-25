import { redirect } from "next/navigation";
import { API_URL, getToken } from "@/lib/org-api";

/**
 * Streams the report CSV to the browser.
 *
 * The session lives in an httpOnly cookie scoped to this origin, so the
 * browser cannot call the API directly for a download — this handler
 * attaches the token server-side and passes the file through, filename and
 * all.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const token = await getToken();
  if (!token) redirect("/login");

  const upstream = await fetch(`${API_URL}/events/${id}/report?format=csv`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!upstream.ok) {
    return new Response("Could not build that report.", { status: upstream.status });
  }

  // arrayBuffer, not text(): fetch's text() strips a leading BOM per spec,
  // and that BOM is the only reason Excel opens "Mr & Mrs Adeyemi" and ₦
  // correctly instead of as mojibake. Pass the bytes through untouched.
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        upstream.headers.get("content-disposition") ??
        'attachment; filename="report.csv"',
      "cache-control": "no-store",
    },
  });
}
