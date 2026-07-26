import { env } from "./env.ts";

/**
 * SMS delivery, kept behind an interface for the same two reasons as
 * paystack.ts: tests must never touch the network, and Africa's Talking is
 * the documented alternative (HANDOFF §3) so a second provider slots in
 * beside this one rather than through it.
 *
 * Termii is primary — Nigerian routes, and unlike Twilio it can reach
 * numbers on the Do-Not-Disturb list.
 *
 * We keep our own hashed code and never touch Termii's token endpoint: the
 * code has to be verifiable offline, against our own row, and it must stay
 * a hash we can compare in constant time (auth.ts).
 */

export type SmsMessage = {
  /** E.164, with the leading +. Providers that want it stripped strip it. */
  to: string;
  text: string;
};

export interface SmsSender {
  readonly name: string;
  /**
   * True only for senders that do not actually deliver anything, and is
   * the single gate on returning dev_code in a response. A real sender
   * must never let a code back out over HTTP.
   */
  readonly echoesCodes: boolean;
  /** Rejects if the message was not accepted for delivery. */
  send(msg: SmsMessage): Promise<void>;
}

/** A provider refused or was unreachable. auth.ts turns this into a 502. */
export class SmsSendError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SmsSendError";
  }
}

const SEND_TIMEOUT_MS = 10_000;

export class TermiiSender implements SmsSender {
  readonly name = "termii";
  readonly echoesCodes = false;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    /**
     * "dnd" is not optional in practice. A large share of Nigerian numbers
     * sit on the Do-Not-Disturb list, and the generic route accepts the
     * message, returns success, and silently never delivers it. Overridable
     * only because a fully whitelisted sender ID can use "generic" and pay
     * less.
     */
    private readonly channel: string,
  ) {}

  async send(msg: SmsMessage): Promise<void> {
    let res: Response;
    try {
      res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          to: msg.to.replace(/^\+/, ""), // Termii wants 234…, not +234…
          from: this.from,
          sms: msg.text,
          type: "plain",
          channel: this.channel,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout or DNS/socket failure. Someone is staring at a login form.
      throw new SmsSendError("Termii unreachable", err);
    }

    // Termii answers 200 with a JSON body either way; the body is the truth.
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
      message_id?: string;
    } | null;

    if (!res.ok || (body?.code && body.code !== "ok")) {
      throw new SmsSendError(
        `Termii refused: ${body?.message ?? body?.code ?? res.status}`,
      );
    }
  }
}

/**
 * Local stand-in. Used when TERMII_API_KEY is unset, so the whole login
 * loop can be exercised offline — the code goes to the server log and back
 * in the response as dev_code.
 *
 * Deliberately refuses to exist in production: without it, a deploy that
 * forgot the API key would look healthy and quietly send nobody anything.
 */
export class LogSender implements SmsSender {
  readonly name = "log";
  readonly echoesCodes = true;
  /** Everything "sent", in order — the assertion surface for tests. */
  readonly sent: SmsMessage[] = [];

  constructor() {
    if (!env.isDev) {
      throw new Error(
        "No SMS provider configured. Set TERMII_API_KEY — nobody can sign in without it.",
      );
    }
  }

  async send(msg: SmsMessage): Promise<void> {
    this.sent.push(msg);
    console.log(`[sms:log] ${msg.to} — ${msg.text}`);
  }
}

/** A sender that always fails, for exercising the 502 path. Tests only. */
export class FailingSender implements SmsSender {
  readonly name = "failing";
  readonly echoesCodes = false;
  async send(): Promise<void> {
    throw new SmsSendError("deliberate test failure");
  }
}

export function makeSender(): SmsSender {
  return env.termiiApiKey
    ? new TermiiSender(env.termiiApiKey, env.smsSenderId, env.smsChannel)
    : new LogSender();
}
