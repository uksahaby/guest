import Link from "next/link";
import { notFound } from "next/navigation";
import { api, type EventShape, type InvitationRow } from "@/lib/org-api";

/**
 * Invitations — who has a link, who has been sent one, who opened it.
 *
 * This product does not send anything. It mints a one-time link per
 * household and the organiser shares it over WhatsApp, which is how
 * Nigerian weddings already work and costs nothing per guest. So there is
 * no "delivered" column and there cannot be one: nothing reports a
 * receipt. The four stages that are actually known are link generated,
 * marked sent, opened, replied.
 *
 * Saying "Delivered 97.7%" from data we do not have would be the most
 * comfortable lie on the screen and the first one to cost somebody a
 * guest who never got their pass.
 */

type Row = InvitationRow & {
  sent_at: string | null;
  opened_at: string | null;
  responded_at: string | null;
};

type ListResponse = {
  data: Row[];
  total: number;
  delivery: {
    households: number;
    generated: number;
    sent: number;
    opened: number;
    responded: number;
  };
};

const PER_PAGE = 25;

function rate(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}% of ${of} households` : "—";
}

function initial(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[A-Za-zÀ-ɏ]/.test(w));
  return (words[words.length - 1] ?? name).slice(0, 1).toUpperCase();
}

function withParams(
  base: Record<string, string | undefined>,
  change: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function InvitationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { status: st, data: event } = await api<EventShape>(`/events/${id}`);
  if (st !== 200) notFound();

  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * PER_PAGE;

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (sp.status) query.set("status", sp.status);
  query.set("limit", String(PER_PAGE));
  query.set("offset", String(offset));

  const { data: list } = await api<ListResponse>(
    `/events/${id}/invitations?${query.toString()}`,
  );

  const d = list.delivery;
  const base = { q: q || undefined, status: sp.status };
  const here = `/events/${id}/invitations`;
  const pages = Math.max(1, Math.ceil(list.total / PER_PAGE));
  const from = list.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PER_PAGE, list.total);

  const fmt = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Lagos",
  });
  const when = (iso: string | null) =>
    iso ? fmt.format(new Date(iso)) : <span className="none">—</span>;

  const cards: { key?: string; label: string; n: number; foot: string; tone: string }[] = [
    { key: "link_generated", label: "Links ready", n: d.generated, foot: rate(d.generated, d.households), tone: "" },
    { key: "sent", label: "Marked sent", n: d.sent, foot: rate(d.sent, d.households), tone: "warn" },
    { key: "opened", label: "Opened", n: d.opened, foot: rate(d.opened, d.households), tone: "ok" },
    { key: "responded", label: "Replied", n: d.responded, foot: rate(d.responded, d.households), tone: "ok" },
  ];

  const icon: Record<string, string> = {
    link_generated: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
    sent: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
    opened: "M3 8l9 6 9-6M3 6h18v12H3z",
    responded: "M20 6 9 17l-5-5",
  };

  return (
    <>
      <nav className="crumbs">
        <Link href="/events">My events</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/events/${id}`}>{event.name}</Link>
        <span aria-hidden="true">›</span>
        <b>Invitations</b>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page">Invitations</h1>
          <p className="sub">
            One link per household, shared on WhatsApp. Nothing is emailed.
          </p>
        </div>
        <div className="head-actions">
          <Link className="ghost" href={`/events/${id}/guests`}>
            Guest list
          </Link>
          <Link className="primary" href={`/events/${id}/guests?rsvp=no_response`}>
            Chase non-responders
          </Link>
        </div>
      </div>

      <div className="stats four">
        {cards.map((card) => {
          const on = (sp.status ?? "") === card.key;
          return (
            <Link
              key={card.label}
              href={`${here}${withParams(base, { status: on ? undefined : card.key, page: undefined })}`}
              className={`card stat filter${on ? " on" : ""}`}
            >
              <span className={`stat-icon ${card.tone}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icon[card.key!]} />
                </svg>
              </span>
              <div>
                <p className="stat-label">{card.label}</p>
                <p className="stat-value">{card.n.toLocaleString("en-NG")}</p>
                <p className="stat-foot">{card.foot}</p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid-side">
        <div className="card">
          <form method="GET" className="filters">
            <input className="field search" type="search" name="q" defaultValue={q}
              placeholder="Search by name, phone or email…" aria-label="Search" />
            <select className="field" name="status" defaultValue={sp.status ?? ""}
              aria-label="Invitation status">
              <option value="">Any stage</option>
              <option value="not_sent">No link yet</option>
              <option value="link_generated">Link ready, not sent</option>
              <option value="sent">Sent, not opened</option>
              <option value="opened">Opened</option>
              <option value="responded">Replied</option>
            </select>
            <button className="ghost" type="submit">Apply</button>
            {(q || sp.status) && <Link className="ghost" href={here}>Clear</Link>}
          </form>

          {list.data.length === 0 ? (
            <p className="sub" style={{ padding: "20px 0" }}>
              {q || sp.status
                ? "No households at that stage."
                : "No households yet. Import a guest list first."}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="list guests">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Stage</th>
                    <th>Sent</th>
                    <th>Opened</th>
                    <th>Replied</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="who">
                          <span className="avatar" aria-hidden="true">
                            {initial(row.display_name)}
                          </span>
                          <div>
                            <b>{row.display_name}</b>
                            <small>
                              {row.primary_phone ?? "no phone on file"}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge d-${row.delivery_state}`}>
                          {row.delivery_state === "not_sent"
                            ? "No link"
                            : row.delivery_state === "link_generated"
                              ? "Link ready"
                              : row.delivery_state === "opened"
                                ? "Opened"
                                : "Sent"}
                        </span>
                      </td>
                      <td className="mono">{when(row.sent_at)}</td>
                      <td className="mono">{when(row.opened_at)}</td>
                      <td className="mono">{when(row.responded_at)}</td>
                      <td className="right">
                        <Link className="ghost sm"
                          href={`/events/${id}/guests/${row.id}/link`}>
                          Get link
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {list.total > 0 && (
            <div className="pager">
              <span className="sub">
                Showing {from}–{to} of {list.total.toLocaleString("en-NG")}
              </span>
              <div className="pages">
                {page > 1 && (
                  <Link className="ghost sm"
                    href={`${here}${withParams(base, { page: String(page - 1) })}`}>
                    ‹ Previous
                  </Link>
                )}
                <span className="sub">Page {page} of {pages}</span>
                {page < pages && (
                  <Link className="ghost sm"
                    href={`${here}${withParams(base, { page: String(page + 1) })}`}>
                    Next ›
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="rail">
          <section className="card">
            <h2 className="card-title">Quick actions</h2>
            <ul className="actions">
              <li>
                <Link href={`/events/${id}/guests?rsvp=no_response`}>
                  <strong>Chase non-responders</strong>
                  <small>Households that never opened their invitation</small>
                </Link>
              </li>
              <li>
                <Link href={`${here}?status=link_generated`}>
                  <strong>Links ready to send</strong>
                  <small>Generated but not yet marked as sent</small>
                </Link>
              </li>
              <li>
                <Link href={`${here}?status=not_sent`}>
                  <strong>No link yet</strong>
                  <small>Households with nothing to send</small>
                </Link>
              </li>
              <li>
                <Link href={`/events/${id}/guests/import`}>
                  <strong>Import more guests</strong>
                  <small>Add households from a spreadsheet</small>
                </Link>
              </li>
            </ul>
          </section>

          <section className="card">
            <h2 className="card-title">How sending works</h2>
            <p className="sub">
              Each household gets a one-time link. You share it on WhatsApp,
              which is free and is where your guests already are.
            </p>
            <p className="sub" style={{ marginTop: 10 }}>
              Because you send it yourself, nothing can report delivery — so
              this screen shows <b>opened</b> instead, which is the first
              moment we can honestly say the invitation arrived.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
