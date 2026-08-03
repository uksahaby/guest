"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, getToken, API_URL } from "@/lib/org-api";

/**
 * Settings actions. Each toggle is its own form, so a change saves on the
 * spot and nothing else in the page can be altered by accident — a
 * settings screen with one big Save button is how people change a gate
 * policy they never meant to touch.
 */

function back(eventId: string, ok: boolean, what?: string, tab?: string): never {
  revalidatePath(`/events/${eventId}/settings`);
  const qs = new URLSearchParams();
  if (tab) qs.set("tab", tab);
  if (ok && what) qs.set("saved", what);
  if (!ok) qs.set("error", what ?? "1");
  const s = qs.toString();
  redirect(`/events/${eventId}/settings${s ? `?${s}` : ""}`);
}

/**
 * How many milliseconds a zone is ahead of UTC at a given instant.
 *
 * Formatting the instant in the target zone and reading the result back as
 * if it were UTC gives the offset, daylight saving and all. Nigeria has no
 * DST, but the organiser picks the zone and nothing stops them picking one
 * that does.
 */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second),
  );
  return asUtc - at.getTime();
}

/**
 * "24 Aug 2025, 2pm, West Africa Time" as an instant.
 *
 * The organiser types a wall clock reading and means it in the event's
 * zone, never the browser's — a planner in London setting a Lagos wedding
 * to 2pm means 2pm in Lagos.
 */
function zonedToUtc(date: string, time: string, tz: string): string | null {
  if (!date) return null;
  const naive = new Date(`${date}T${time || "00:00"}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  return new Date(naive.getTime() - offsetMs(naive, tz)).toISOString();
}

export async function updateEvent(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const field = String(formData.get("field") ?? "");
  const raw = formData.get("value");

  // Text and date fields post `value`; toggles post `on` only when ticked,
  // so its absence is a genuine "false" rather than a missing field.
  const body: Record<string, unknown> =
    field === "rsvp_deadline"
      ? { rsvp_deadline: String(raw ?? "") || null }
      : field === "manager_phone"
        ? { manager_phone: String(raw ?? "").trim() || null }
        : field === "name"
          ? { name: String(raw ?? "") }
          : field === "status"
            ? { status: String(raw ?? "") }
            : { [field]: formData.get("on") === "on" };

  const { status } = await api(`/events/${eventId}`, { method: "PATCH", body });
  // Back to the tab the switch lives on, not the top of the page.
  back(eventId, status === 200, field, String(formData.get("tab") ?? "") || undefined);
}

/**
 * The Event Details tab: one Save Changes button over every text field on
 * it, which is what the settings mockup shows.
 *
 * The batch stops at text. Gate policy — overflow, walk-ins, RSVP required
 * — still saves per switch on its own tab, because the failure mode there
 * is different in kind: a mis-tapped switch that rides along with a name
 * change is how an event arrives at the gate refusing everybody.
 */
export async function saveDetails(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const str = (k: string) => String(formData.get(k) ?? "").trim();

  // An empty tag box means no tags, so the field is always posted and the
  // absence of a value is a real instruction rather than a missing one.
  const tags = str("tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);

  const { status } = await api(`/events/${eventId}`, {
    method: "PATCH",
    body: {
      name: str("name"),
      event_type: str("event_type"),
      description: str("description"),
      end_date: str("end_date") || null,
      tags,
    },
  });
  if (status !== 200) back(eventId, false, "details", "details");

  // The date lives on the leg, not the event: an event is its ceremonies,
  // and the first one is what "Event Date" means.
  const legId = str("leg_id");
  const date = str("event_date");
  if (legId && date) {
    const tz = str("timezone") || "Africa/Lagos";
    const startsAt = zonedToUtc(date, str("start_time"), tz);
    if (startsAt) {
      await api(`/legs/${legId}`, { method: "PATCH", body: { starts_at: startsAt } });
    }
  }

  back(eventId, true, "details", "details");
}

/**
 * The Venue & Time tab. Start and end are wall-clock readings in the
 * event's own zone; the zone is saved first so the times that follow are
 * interpreted in the one the organiser just chose, not the old one.
 */
export async function saveVenue(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const tz = str("timezone") || "Africa/Lagos";

  const ev = await api(`/events/${eventId}`, {
    method: "PATCH",
    body: { timezone: tz },
  });
  if (ev.status !== 200) back(eventId, false, "venue", "venue");

  if (legId) {
    const date = str("event_date");
    const startsAt = zonedToUtc(date, str("start_time"), tz);
    const endsAt = str("end_time") ? zonedToUtc(date, str("end_time"), tz) : null;

    const { status } = await api(`/legs/${legId}`, {
      method: "PATCH",
      body: {
        venue_name: str("venue_name") || null,
        address_line: str("address_line") || null,
        ...(startsAt ? { starts_at: startsAt } : {}),
        // Posted always, so clearing the end time actually clears it.
        doors_close_at: endsAt,
        all_day: formData.get("all_day") === "on",
      },
    });
    if (status !== 200) back(eventId, false, "venue", "venue");
  }

  back(eventId, true, "venue", "venue");
}

/**
 * Publish and unpublish. A draft event is one guests cannot reach yet;
 * active is live. Deliberately not "cancelled" — cancelling tells every
 * guest the wedding is off, and unpublishing must never do that by
 * accident, so they are two different buttons on two different tabs.
 */
export async function setPublished(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const publish = formData.get("publish") === "1";
  const { status } = await api(`/events/${eventId}`, {
    method: "PATCH",
    body: { status: publish ? "active" : "draft" },
  });
  // Back to the tab they were reading — the status card sits in the rail
  // beside every one of them.
  back(
    eventId,
    status === 200,
    publish ? "published" : "unpublished",
    String(formData.get("tab") ?? "") || undefined,
  );
}

/** The custom part of the shareable link, and the guest-access switches. */
export async function saveAccess(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const slug = String(formData.get("slug") ?? "").trim();

  const body: Record<string, unknown> = {
    invitation_only: formData.get("invitation_only") === "on",
    public_page: formData.get("public_page") === "on",
  };
  // Only sent when the form carried the field, so the privacy tab does not
  // wipe a link it never showed.
  if (formData.has("slug")) body.slug = slug;

  const { status, data } = await api<{ code?: string }>(`/events/${eventId}`, {
    method: "PATCH",
    body,
  });
  // The reason matters here: "slug_taken" is a different conversation from
  // "that didn't save", and the organiser can act on the first one.
  if (status !== 200) back(eventId, false, data?.code ?? "1", "privacy");
  back(eventId, true, "access", "privacy");
}

export async function updateLeg(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const legId = String(formData.get("leg_id") ?? "");
  const startsAt = String(formData.get("starts_at") ?? "");

  const { status } = await api(`/legs/${legId}`, {
    method: "PATCH",
    body: {
      ...(String(formData.get("name") ?? "").trim()
        ? { name: String(formData.get("name")) }
        : {}),
      ...(startsAt ? { starts_at: new Date(startsAt).toISOString() } : {}),
      venue_name: String(formData.get("venue_name") ?? "") || null,
      address_line: String(formData.get("address_line") ?? "") || null,
      city: String(formData.get("city") ?? "") || null,
    },
  });
  back(eventId, status === 200, "basics");
}

export async function reissuePasses(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  // Typing the word is the confirmation — a dialog would be a client
  // component for something the user should have to stop and read.
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "REISSUE") {
    back(eventId, false, "1", "passes");
  }
  const { status } = await api(`/events/${eventId}/reissue-passes`, { method: "POST" });
  back(eventId, status === 200, "reissued", "passes");
}

export async function cancelEvent(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const { status } = await api(`/events/${eventId}`, {
    method: "PATCH",
    body: { status: "cancelled" },
  });
  back(eventId, status === 200, "cancelled", "advanced");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    back(eventId, false, "1", "advanced");
  }
  const { status } = await api(`/events/${eventId}`, { method: "DELETE" });
  if (status !== 204) back(eventId, false);
  revalidatePath("/events");
  redirect("/events?deleted=1");
}

/**
 * The event's cover photo — the picture of the couple that appears on the
 * dashboard, the overview and the guest's own invitation page.
 *
 * Streamed as multipart rather than JSON: a 2 MB image base64-encoded is
 * 2.7 MB of memory held for no reason.
 */
export async function uploadCover(formData: FormData): Promise<void> {
  const eventId = String(formData.get("event_id") ?? "");
  const file = formData.get("cover");

  if (!eventId) redirect("/events");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/events/${eventId}/settings?tab=details&error=no_file`);
  }

  const token = await getToken();
  if (!token) redirect("/login");

  const body = new FormData();
  body.set("file", file, file.name || "cover");

  const res = await fetch(`${API_URL}/events/${eventId}/cover`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body,
  });

  if (!res.ok) {
    const problem = await res.json().catch(() => ({ code: "failed" }));
    redirect(
      `/events/${eventId}/settings?tab=details&error=${encodeURIComponent(problem.code ?? "failed")}`,
    );
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/settings`);
  revalidatePath("/dashboard");
  redirect(`/events/${eventId}/settings?tab=details&saved=cover`);
}
