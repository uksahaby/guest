# checkin-core

The check-in state machine, implemented and tested against every outcome in
Phase 4C. Zero dependencies — Node 22's built-in TypeScript and test runner.

```
npm test
```

## What's here

| File | |
|---|---|
| `src/token.ts` | Pass token signing and verification. HMAC-SHA256, offline-verifiable, 64 chars. |
| `src/checkin.ts` | `decide()` — the state machine. Pure: no database, no clock, no network. |
| `src/checkin.test.ts` | 35 tests. The specification, executable. |

## Why `decide()` is pure

It takes everything it needs as arguments and returns a decision. That means
the identical logic runs on a scanner phone with no signal and on the server
when the queue syncs three hours later, and neither needs a database to be
tested.

It also means porting to Dart is mechanical, and the test cases port with it.
This function is the only logic that exists in two languages — keep it that
way.

## Wiring it up

**On the scanner**

```ts
const d = decide(ctx, { kind: "scan", raw: decoded });

if (d.outcome === "needs_count") {
  const n = await askUsher(d.choices!);           // pre-select d.remaining
  const final = decide(ctx, { kind: "scan", raw: decoded, requestedCount: n });
  if (final.log) queue.push(toRow(final, crypto.randomUUID()));
} else if (d.log) {
  queue.push(toRow(d, crypto.randomUUID()));
}

render(d);                                        // tone, headline, actions
if (d.autoReturnMs !== null) setTimeout(reopenCamera, d.autoReturnMs);
```

**On the server**

Re-run `decide()` against database state when the queue arrives. Trust the
device for *what happened at the gate* — never for *whether it was allowed*.
A modified client can post `admitted` for a revoked pass; the server must
catch it and record its own verdict.

## The invariants

Four tests at the bottom of the suite hold the design in place. Break one and
something in the product breaks with it:

- Only admissions reset the camera. Everything else waits for a human, because
  a refusal means a conversation is happening at the gate.
- Refusals admit nobody.
- Every refusal is logged — that report is one of the things organisers value most.
- The count prompt is the only unlogged outcome.

## Not implemented here

Reversals and check-out. The schema and the enums carry them; `decide()`
doesn't, because both are corrections applied to the log rather than decisions
made at the gate.
