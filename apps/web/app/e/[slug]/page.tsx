import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { callerHeaders } from "@/lib/org-api";
import "../../(guest)/guest.css";

/**
 * The public event page — /e/<slug>.
 *
 * What "Public Event Page" in Event Settings actually turns on, and what
 * the Event Link there points at. Off by default and only ever reachable
 * when an organiser has said so.
 *
 * The difference from a household's invitation page at /i/<token> is the
 * whole point: this one has no pass, no RSVP, no QR and no name on it. It
 * is the poster on the wall — date, place, and what the couple wanted to
 * say. Row-level security is what guarantees that rather than this file
 * (db/migrations/018): the connection serving this page cannot read the
 * guest list even if someone later asks it to.
 *
 * It carries its own fonts and metadata rather than sitting in the (guest)
 * route group, because that group sets robots: noindex — correct for a
 * household's private page, wrong for a page whose reason to exist is
 * being findable.
 */

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

type Leg = {
  id: string;
  name: string;
  starts_at: string;
  doors_close_at: string | null;
  all_day: boolean;
  venue_name: string | null;
  address_line: string | null;
  city: string | null;
  latitude: string | null;
  longitude: string | null;
};

type PublicEvent = {
  id: string;
  name: string;
  event_type: string;
  description: string | null;
  tags: string[];
  end_date: string | null;
  timezone: string;
  has_cover: boolean;
  legs: Leg[];
};

const API_URL = process.env.API_URL ?? "http://localhost:3001";

async function getEvent(slug: string): Promise<PublicEvent | null> {
  const res = await fetch(
    `${API_URL}/public/events/${encodeURIComponent(slug)}`,
    { cache: "no-store", headers: await callerHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ev = await getEvent(slug);
  if (!ev) return { title: "Event" };
  return {
    title: ev.name,
    description: ev.description ?? undefined,
    // The opposite of the household pages, deliberately. This one is meant
    // to be found.
    robots: { index: true },
    openGraph: {
      title: ev.name,
      description: ev.description ?? undefined,
      images: ev.has_cover ? [`/api/events/${ev.id}/cover`] : undefined,
    },
  };
}

function when(leg: Leg, tz: string): string {
  const day = new Intl.DateTimeFormat("en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: tz,
  }).format(new Date(leg.starts_at));
  if (leg.all_day) return day;
  const time = new Intl.DateTimeFormat("en-NG", {
    hour: "numeric", minute: "2-digit", timeZone: tz,
  }).format(new Date(leg.starts_at));
  return `${day} · ${time}`;
}

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ev = await getEvent(slug);
  // An unknown slug and an event whose public page is off are the same
  // 404. An organiser who has not opted in has not confirmed it exists.
  if (!ev) notFound();

  const couple = ev.name.split("&").map((s) => s.trim());
  const tz = ev.timezone || "Africa/Lagos";

  return (
    <div className={`${cormorant.variable} ${inter.variable} guest-root`}>
      <div className="frame">
        <header className="hero">
          <div className="names fade">
            {couple.length === 2 ? (
              <>
                <span className="n">{couple[0]}</span>
                <span className="amp">&amp;</span>
                <span className="n">{couple[1]}</span>
              </>
            ) : (
              <span className="single">{ev.name}</span>
            )}
          </div>
          <div className="rule fade" />
          {ev.description ? (
            <p className="invited fade">{ev.description}</p>
          ) : (
            <p className="invited fade">
              request the pleasure of
              <br />
              your company
            </p>
          )}
          {ev.legs[0] && (
            <div className="when fade">
              <div className="d">{when(ev.legs[0], tz)}</div>
              {ev.legs[0].venue_name && <div className="p">{ev.legs[0].venue_name}</div>}
            </div>
          )}
        </header>

        <section className="panel">
          {ev.legs.map((leg) => (
            <div className="sec" key={leg.id}>
              <h3>{leg.name}</h3>
              <div className="line">
                <span className="q">When</span>
                <span>{when(leg, tz)}</span>
              </div>
              {leg.venue_name && (
                <div className="line">
                  <span className="q">Where</span>
                  <span>
                    {leg.venue_name}
                    {leg.address_line ? `, ${leg.address_line}` : ""}
                    {leg.city ? `, ${leg.city}` : ""}
                  </span>
                </div>
              )}
              {leg.latitude && leg.longitude && (
                <a
                  className="maplink"
                  href={`https://www.google.com/maps/search/?api=1&query=${leg.latitude},${leg.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in maps
                </a>
              )}
            </div>
          ))}

          {/* No RSVP and no pass here on purpose. Replying is something a
              household does from its own invitation link, which is the
              only thing that knows how many seats it holds. */}
          <p className="note">
            Invited guests have their own link with their pass and reply on
            it. If you were invited and cannot find yours, ask the couple.
          </p>
        </section>
      </div>
    </div>
  );
}
