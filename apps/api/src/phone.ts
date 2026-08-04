/**
 * Reading a Nigerian phone number the way a Nigerian writes it.
 *
 * The phone number is this product's primary identifier — it is how an
 * organiser signs in, how an usher is invited, and how a guest is matched
 * on import. So it is worth being generous about the shape it arrives in.
 *
 * The rule already existed. csv.ts has had it since the guest importer was
 * built, tested against the mockup's own sample "0803 411 2098", because a
 * spreadsheet from a real wedding contains every one of these forms:
 *
 *   0803 411 2098   the way it is written on a card
 *   08034112098     the way it is typed into a phone
 *   8034112098      the way it is stored with the trunk prefix dropped
 *   2348034112098   the way it comes back from some exports
 *   +234 803 411 2098   E.164, which is what wa.me needs
 *
 * What did NOT use that rule was authentication. auth.ts and team.ts each
 * carried their own copy that demanded E.164 and rejected everything else,
 * so an organiser typing their own number the ordinary way was told "that
 * phone number and password don't match" — a wrong-password error for a
 * formatting difference, on the first screen anyone sees. An usher invited
 * as 0803… was refused outright.
 *
 * One implementation now, in one place, so the three surfaces cannot drift
 * apart again. Nigeria is assumed for a bare local number and that is a
 * deliberate, pre-existing choice: naira pricing, Termii's DND routing and
 * the whole handoff say who this is for. An international number still
 * works when written with its + and country code, which is the only way it
 * could ever be unambiguous.
 */

/** What the database stores and wa.me needs. */
export const E164 = /^\+\d{8,15}$/;

/**
 * Lenient: turns the forms above into E.164, or null when it is too short
 * to be a phone number at all. Deliberately does not judge length beyond
 * that — the importer wants to warn about a doubtful row rather than throw
 * it away, so the caller decides.
 */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return null;

  // An explicit + means the writer already said which country.
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("234")) return `+${digits}`;
  // Local trunk prefix: 0803… → +234803…
  if (digits.startsWith("0")) return `+234${digits.slice(1)}`;
  // Bare subscriber number, 10 digits: 803…
  if (digits.length === 10) return `+234${digits}`;
  return `+${digits}`;
}

/**
 * Strict: the same reading, then held to E.164 before it is allowed to
 * identify anybody. Sign-in and invitations use this — a number that is
 * going to become an account has to be a whole number, not a plausible
 * fragment of one.
 */
export function toE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = normalisePhone(raw);
  return p && E164.test(p) ? p : null;
}
