/**
 * EventFlow — the name, set the way the mockups set it.
 *
 * One component rather than the eight hand-written copies this replaced,
 * because a brand that is spelled out in eight files is a brand that is
 * eventually spelled two ways. "Working name" is gone: it was a label
 * admitting there wasn't one, and now there is.
 *
 * The lockup is three parts, and the mockup gives each its own treatment:
 *
 *   a monogram in a gold rule — EF, where the mockup's placeholder art has
 *     SF, which belongs to whoever drew it rather than to this product
 *   EventFlow, in the serif — Cormorant Garamond, the face the guest
 *     invitation already uses
 *   EVENTS, PERFECTED, in gold, letterspaced, small
 *
 * `tone` picks the palette rather than a second component: on the dark
 * green panels the wordmark is cream, and on white it is the deep green,
 * because gold-on-white at 10px fails contrast badly enough to be
 * unreadable rather than merely subtle.
 */

export function Brand({
  tone = "dark",
  size = "md",
  tagline = true,
}: {
  tone?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  tagline?: boolean;
}) {
  return (
    <span className={`brandmark tone-${tone} size-${size}`}>
      <span className="brandmark-mark" aria-hidden="true">EF</span>
      <span className="brandmark-words">
        <strong>EventFlow</strong>
        {tagline && <small>Events, perfected</small>}
      </span>
    </span>
  );
}

/** The name on its own, for running text and page titles. */
export const BRAND = "EventFlow";
export const BRAND_TAGLINE = "Events, perfected";
