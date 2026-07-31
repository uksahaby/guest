/**
 * Throttling for the endpoints anyone on the internet can reach.
 *
 * Everything else in the API is behind a JWT. These are not: signup,
 * password login, recovery, OTP, the staff-invite link and the guest
 * invitation pages. Until now none of them had any limit at all beyond the
 * OTP resend window, which is fine while nothing is deployed and is the
 * first thing to fix the moment staging has a public URL.
 *
 * Two dimensions, and the asymmetry between them is the whole design:
 *
 *   per identifier (a phone number)  — tight. This is the real defence.
 *   per IP address                   — generous. This is a ceiling on
 *                                      volume, not an identity check.
 *
 * The reason is local. Nigerian mobile networks put enormous numbers of
 * subscribers behind a handful of carrier-NAT addresses, so an IP here is
 * closer to "a city on MTN" than to "a person". A per-IP limit tight enough
 * to stop a determined attacker would lock out a neighbourhood, and the
 * people it locks out are guests trying to RSVP on event morning. So the
 * per-IP numbers below are set where no honest user could plausibly reach
 * them, and the work of stopping a password-guesser is done per phone
 * number — which is the thing the attacker actually has to hold still.
 *
 * Counting failures, not requests, on login and recovery. Someone who
 * signs in successfully ten times is not an attacker, and burning their
 * budget for it means the limiter's first victim is our most active
 * organiser. A success clears the count.
 *
 * In memory, deliberately. The alternative is a counter row in Postgres,
 * which is a write on every request to a database that is currently
 * us-east-1 — paying a transatlantic round trip at the door in order to
 * protect the door. The cost of memory is that limits are per process: two
 * API instances behind a load balancer each allow the full budget. At one
 * instance, which is what is deployed and what a wedding needs, it is
 * exact. Revisit if the API is ever scaled out, and note that the per-phone
 * limits degrade gracefully — two instances means twice the attempts, not
 * no limit.
 *
 * No timers. A setInterval sweep would keep the process alive and hang the
 * test runner; expired entries are dropped lazily instead.
 */

export type Verdict =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

const OK: Verdict = { ok: true };

/** Entries are swept when the map grows past this. */
const SWEEP_AT = 10_000;

/**
 * A fixed window per key. Fixed rather than sliding because the failure
 * mode of a fixed window — up to 2x the limit across a window boundary —
 * does not matter for numbers chosen this far from honest usage, and a
 * sliding log costs a timestamp array per key.
 */
export class Window {
  readonly limit: number;
  readonly windowMs: number;
  #hits = new Map<string, { n: number; resetAt: number }>();

  constructor(opts: { limit: number; windowMs: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
  }

  #live(key: string, now: number) {
    const cur = this.#hits.get(key);
    if (!cur || cur.resetAt <= now) return null;
    return cur;
  }

  /** Is this key already over? Does not count against it. */
  peek(key: string, now = Date.now()): Verdict {
    const cur = this.#live(key, now);
    if (!cur || cur.n < this.limit) return OK;
    return { ok: false, retryAfterSeconds: Math.ceil((cur.resetAt - now) / 1000) };
  }

  /** Count one against this key. */
  bump(key: string, now = Date.now()): void {
    if (this.#hits.size > SWEEP_AT) this.#sweep(now);
    const cur = this.#live(key, now);
    if (cur) cur.n += 1;
    else this.#hits.set(key, { n: 1, resetAt: now + this.windowMs });
  }

  /**
   * Count one and say whether that one was over the line. For limits that
   * count every request rather than every failure.
   */
  hit(key: string, now = Date.now()): Verdict {
    const before = this.peek(key, now);
    this.bump(key, now);
    return before;
  }

  /** A success wipes the slate — see the note on counting failures. */
  forget(key: string): void {
    this.#hits.delete(key);
  }

  /** Tests only. */
  clear(): void {
    this.#hits.clear();
  }

  #sweep(now: number): void {
    for (const [key, v] of this.#hits) if (v.resetAt <= now) this.#hits.delete(key);
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The limits, in one place so they can be read as a policy rather than
 * hunted for across route files.
 *
 * Created per server instance rather than as module state: each test file
 * builds its own server and every injected request arrives from 127.0.0.1,
 * so shared state would make one test's traffic another test's lockout.
 */
export function createLimits() {
  return {
    /**
     * Real money when Termii is configured — each request is an SMS. The
     * existing 30-second resend window is per phone and does nothing to
     * stop one caller walking a list of numbers.
     */
    otpRequestPerIp: new Window({ limit: 20, windowMs: HOUR }),
    /**
     * A code is 6 digits and already dies after 5 wrong attempts, but a
     * caller can keep asking for fresh codes. This caps the whole game.
     */
    otpVerifyPerIp: new Window({ limit: 60, windowMs: HOUR }),

    /** One person signs up once. Twenty an hour is an office, not a bot. */
    signupPerIp: new Window({ limit: 20, windowMs: HOUR }),

    /** The one that matters: guessing a password for a known number. */
    loginFailPerPhone: new Window({ limit: 10, windowMs: 15 * MINUTE }),
    loginPerIp: new Window({ limit: 100, windowMs: 15 * MINUTE }),

    /**
     * Tighter than login. A recovery code is the whole account and there
     * is no second factor behind it.
     */
    recoveryFailPerPhone: new Window({ limit: 5, windowMs: HOUR }),
    recoveryPerIp: new Window({ limit: 30, windowMs: HOUR }),

    /** Invite tokens are unguessable; this stops anyone trying anyway. */
    inviteAcceptPerIp: new Window({ limit: 60, windowMs: HOUR }),

    /**
     * The guest surface. Highest ceiling of the lot, because this is where
     * carrier NAT bites hardest: one link goes to a WhatsApp group and two
     * hundred households on the same network open it in the same minute.
     */
    publicPerIp: new Window({ limit: 600, windowMs: 15 * MINUTE }),
  };
}

export type Limits = ReturnType<typeof createLimits>;

/**
 * The 429, shaped exactly like the OTP resend one that predates this file
 * so clients have a single case to handle. Retry-After is there for the
 * benefit of anything that reads headers rather than bodies.
 */
export function tooMany(
  reply: {
    header(k: string, v: string): unknown;
    code(n: number): { send(body: unknown): unknown };
  },
  verdict: Extract<Verdict, { ok: false }>,
  message: string,
) {
  reply.header("Retry-After", String(verdict.retryAfterSeconds));
  return reply.code(429).send({
    code: "rate_limited",
    message,
    retry_after_seconds: verdict.retryAfterSeconds,
  });
}
