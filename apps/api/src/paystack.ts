import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.ts";

/**
 * Paystack, kept behind an interface for two reasons: tests must never
 * touch the network, and Flutterwave is the documented alternative
 * (HANDOFF §3) so the second provider should slot in beside this one
 * rather than through it.
 *
 * Fees, for reference — ours to absorb, not to charge on: 1.5% + ₦100,
 * capped ₦2,000, the ₦100 waived under ₦2,500.
 */

export type InitialiseArgs = {
  reference: string;
  amountMinor: number;
  email: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
};

export type Initialised = { authorizationUrl: string; reference: string };

export interface PaymentProvider {
  readonly name: string;
  initialise(args: InitialiseArgs): Promise<Initialised>;
  /** True when the raw body genuinely came from the provider. */
  verifySignature(rawBody: string, signature: string | undefined): boolean;
}

export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";
  constructor(private readonly secretKey: string) {}

  async initialise(args: InitialiseArgs): Promise<Initialised> {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        reference: args.reference,
        amount: args.amountMinor, // kobo
        email: args.email,
        currency: "NGN",
        callback_url: args.callbackUrl,
        metadata: args.metadata,
      }),
    });
    const body = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string; reference?: string };
    };
    if (!res.ok || !body.status || !body.data?.authorization_url) {
      throw new Error(`Paystack initialise failed: ${body.message ?? res.status}`);
    }
    return {
      authorizationUrl: body.data.authorization_url,
      reference: body.data.reference ?? args.reference,
    };
  }

  /**
   * HMAC-SHA512 of the RAW request body, keyed on the secret key. It must
   * be the exact bytes Paystack sent — re-serialising the parsed JSON
   * changes key order and whitespace and the digest stops matching, which
   * is the classic way this check gets quietly broken.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/**
 * Local stand-in. Used when PAYSTACK_SECRET_KEY is unset so the whole
 * checkout → webhook loop can be exercised offline, including a real
 * signature check (it signs with the dev key).
 *
 * Deliberately refuses to exist in production.
 */
export class StubProvider implements PaymentProvider {
  readonly name = "paystack";
  readonly devKey = "stub-paystack-key";
  readonly initialised: InitialiseArgs[] = [];

  constructor() {
    if (!env.isDev) throw new Error("StubProvider must never run in production");
  }

  async initialise(args: InitialiseArgs): Promise<Initialised> {
    this.initialised.push(args);
    return {
      authorizationUrl: `https://checkout.local/stub/${args.reference}`,
      reference: args.reference,
    };
  }

  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac("sha512", this.devKey).update(rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function makeProvider(): PaymentProvider {
  return env.paystackSecretKey
    ? new PaystackProvider(env.paystackSecretKey)
    : new StubProvider();
}
