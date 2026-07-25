"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { API_URL, requireToken } from "@/lib/org-api";

/**
 * Two-step import, matching the mockup: preview first, then commit.
 *
 * The file never touches the client's JavaScript — a plain form post hands
 * it to this action, which forwards it to the API with the session token.
 * Preview state is passed back through the URL rather than held in a
 * session, so a refresh does the honest thing (re-shows the upload form)
 * instead of committing something the organiser can't see.
 */

const FIELDS = [
  "display_name", "allowance", "primary_phone",
  "primary_email", "category", "table", "ignore",
] as const;

async function send(
  eventId: string,
  file: File,
  extra: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const token = await requireToken();
  const form = new FormData();
  form.append("file", file, file.name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);

  const res = await fetch(`${API_URL}/events/${eventId}/invitations/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
    cache: "no-store",
  });
  return { status: res.status, body: await res.json() };
}

export type Preview = {
  file: string | null;
  total_rows: number;
  headers: string[];
  mapping: Record<string, string>;
  has_allowance_column: boolean;
  would_import: number;
  already_on_list: number;
  people: number;
  warning_summary: { kind: string; count: number; message: string }[];
  preview: {
    row: number;
    display_name: string;
    allowance: number;
    primary_phone: string | null;
    category: string | null;
    table: string | null;
  }[];
};

/** Step one: parse and report, writing nothing. */
export async function previewImport(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/events/${eventId}/guests/import?error=no_file`);
  }

  const { status, body } = await send(eventId, file, { dry_run: "true" });
  if (status !== 200) {
    const code = (body as { code?: string }).code ?? "failed";
    redirect(`/events/${eventId}/guests/import?error=${code}`);
  }

  // Carrying the parsed result through a redirect would mean a huge URL, so
  // the file is simply re-sent on confirm. Guest lists are kilobytes.
  const p = body as Preview;
  const params = new URLSearchParams({
    preview: JSON.stringify({
      file: p.file,
      total_rows: p.total_rows,
      headers: p.headers,
      mapping: p.mapping,
      has_allowance_column: p.has_allowance_column,
      would_import: p.would_import,
      already_on_list: p.already_on_list,
      people: p.people,
      warning_summary: p.warning_summary,
      preview: p.preview,
    }),
  });
  redirect(`/events/${eventId}/guests/import?${params}`);
}

/** Step two: the same file, plus any corrections to the mapping. */
export async function commitImport(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/events/${eventId}/guests/import?error=no_file`);
  }

  // Column corrections arrive as mapping.0=display_name, mapping.1=…
  const mapping: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("mapping.")) continue;
    const index = key.slice("mapping.".length);
    const v = String(value);
    if (/^\d+$/.test(index) && (FIELDS as readonly string[]).includes(v)) {
      mapping[index] = v;
    }
  }

  const { status, body } = await send(eventId, file, {
    ...(Object.keys(mapping).length ? { mapping: JSON.stringify(mapping) } : {}),
  });
  if (status !== 202) {
    const code = (body as { code?: string }).code ?? "failed";
    redirect(`/events/${eventId}/guests/import?error=${code}`);
  }

  const done = body as { imported: number; already_on_list: number };
  revalidatePath(`/events/${eventId}/guests`);
  redirect(
    `/events/${eventId}/guests?imported=${done.imported}&skipped=${done.already_on_list}`,
  );
}
