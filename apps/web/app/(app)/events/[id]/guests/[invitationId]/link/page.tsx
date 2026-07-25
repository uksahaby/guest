import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type DeliveryLink } from "@/lib/org-api";

/**
 * One household's WhatsApp link. Generating it is the billing event —
 * the paywall lives on sending, never on storing (HANDoff §4.5) — and
 * regenerating is free (the API dedupes the delivery row).
 *
 * Opening happens in the organiser's own WhatsApp: zero messaging cost,
 * one tap per household. That trade-off is the whole wedge against
 * API-priced competitors.
 */
export default async function LinkPage({
  params,
}: {
  params: Promise<{ id: string; invitationId: string }>;
}) {
  const { id, invitationId } = await params;

  const { status, data } = await api<
    DeliveryLink[] | { code: string; message: string }
  >(`/events/${id}/delivery-links`, {
    method: "POST",
    body: { invitation_ids: [invitationId] },
  });

  if (status === 402) {
    const err = data as { message: string };
    return (
      <>
        <p className="eyebrow">
          <Link href={`/events/${id}/guests`} style={{ color: "inherit" }}>
            ← Guests
          </Link>
        </p>
        <h1 className="page">Plan limit reached</h1>
        <p className="sub">{err.message}</p>
        <div className="card">
          <p className="sub" style={{ marginTop: 0 }}>
            Upgrading lifts the limit for this event. Nobody on the list is
            lost, and nobody at a gate is ever turned away over billing.
          </p>
        </div>
      </>
    );
  }
  if (status !== 200) notFound();

  const link = (data as DeliveryLink[])[0];
  if (!link) notFound();

  return (
    <>
      <p className="eyebrow">
        <Link href={`/events/${id}/guests`} style={{ color: "inherit" }}>
          ← Guests
        </Link>
      </p>
      <h1 className="page">{link.display_name}</h1>
      <p className="sub">
        The message below opens in your own WhatsApp — nothing is sent until
        you press send there.
      </p>

      <div className="card">
        <div className="msg-preview">{link.message}</div>
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {link.whatsapp_url ? (
            <a className="primary" href={link.whatsapp_url} target="_blank" rel="noreferrer">
              Open in WhatsApp
            </a>
          ) : (
            <p className="form-error" style={{ margin: 0 }}>
              This household has no phone number — share the link below any
              way you like.
            </p>
          )}
        </div>
        <span className="link-out">{link.invite_url}</span>
      </div>
    </>
  );
}
