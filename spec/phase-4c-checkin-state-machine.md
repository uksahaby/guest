# Phase 4C — Check-in State Machine

**Depends on:** Architecture Revision 2 (§2 entities, §3 token, §9 scanner)

This document defines every path through a scan. It constrains the scanner UI, the token payload, the sync logic and the check-in log simultaneously — so it is written before any scanner screen is designed.

---

## 1. Inputs to a decision

| Input | Source | Available offline |
|---|---|---|
| Token integrity | HMAC signature | Yes |
| Event match | Token payload | Yes |
| Pass revocation | Revocation list, synced at event open | Yes, may be stale |
| RSVP status | Invitation record, synced at event open | Yes, may be stale |
| Entry policy | Event settings, synced at event open | Yes |
| Admitted so far | Local log + last server sync | Yes, may be incomplete |
| Party size presenting | **Staff eyes.** Not derivable | — |

The last row is the reason the scanner cannot be fully automatic. Only the person at the door knows that three of a party of four turned up.

---

## 2. Key signing decision

Each event has its own secret. A scanner device downloads the secrets for **every event that staff member is assigned to** when they log in.

On scan, the device attempts verification against each held secret in turn. Most staff hold one, so this is a single operation.

This buys a genuinely useful distinction at the door:

- Verifies under **this** event's secret → proceed
- Verifies under **another** held secret → *"This pass is for Yusuf & Maryam's Wedding"*
- Verifies under none → forged, corrupt, or an unrelated QR code

Without per-device multi-secret loading, a wrong-event pass is indistinguishable from a forgery, and staff get a useless error message.

---

## 3. Evaluation order

Cheapest and most certain checks first. Stop at the first failure.

```
  DECODE        → not our format?           → INVALID
     ↓
  SIGNATURE     → verifies under no secret? → INVALID
     ↓
  EVENT MATCH   → verifies under another?   → WRONG EVENT
     ↓
  REVOCATION    → on revocation list?       → PASS REVOKED
     ↓
  RSVP GATE     → policy requires + pending → NOT CONFIRMED   (overridable)
                → declined                  → DECLINED        (overridable)
     ↓
  ALLOWANCE     → remaining == 0?           → PARTY FULLY ADMITTED
     ↓
  ADMISSION     → allowance == 1?           → AUTO-ADMIT
                → remaining > 1?            → COUNT PROMPT
     ↓
  OVERFLOW      → requested > remaining     → per event policy
```

---

## 4. Outcome table

| # | Outcome | Colour | Auto-return | Log `result` | Staff actions offered |
|---|---|---|---|---|---|
| 1 | **Admitted** (full party) | Green | 1.5s | `admitted` | Undo |
| 2 | **Partially admitted** | Green | 2.5s | `partial` | Undo |
| 3 | **Party fully admitted** | Amber | No | `allowance_exhausted` | Dismiss · Call manager |
| 4 | **Not confirmed** (RSVP pending, policy on) | Amber | No | `rsvp_blocked` | Admit anyway\* · Dismiss |
| 5 | **Declined** | Amber | No | `rsvp_declined` | Admit anyway\* · Dismiss |
| 6 | **Pass revoked** | Red | No | `revoked` | Call manager · Dismiss |
| 7 | **Wrong event** | Red | No | `wrong_event` | Dismiss |
| 8 | **Invalid** | Red | No | `invalid` | Search by name · Dismiss |
| 9 | **Overflow blocked** | Red | No | `overflow_blocked` | Call manager · Dismiss |
| 10 | **Overflow allowed** | Amber | 2.5s | `overflow_admitted` | Undo |
| 11 | **Not found** (manual search) | Red | No | `not_found` | Add walk-in\* · Dismiss |
| 12 | **Manual check-in** | Green | 1.5s | `manual` | Undo |

\* Requires permission. Off by default for Scanner Staff.

**Only green states auto-return.** Every amber and red state waits for a human, because each one means a conversation is happening at the door and the camera reopening mid-sentence loses the result.

---

## 5. Feedback design

Venues are loud, dark, and staff will not be looking at the screen while a queue moves.

| Outcome | Sound | Haptic |
|---|---|---|
| Admitted / partial / manual | Single short tone | Single light tap |
| Amber states | Double tone, lower | Double tap |
| Red states | Long low tone | Long buzz |

Sound and haptic must be distinguishable **without looking**. Colour is never the only signal — every state carries an icon and a text label as well.

---

## 6. The admission step

This is the new logic the household model introduces.

**Allowance = 1 (most guests).** No prompt. Scan, green, 1.5 seconds, camera reopens. This path must never gain an extra tap.

**Remaining > 1.** Count picker, pre-selected at the full remaining number:

```
   MR & MRS ADEYEMI
   Groom's Family · Table 12

   How many arrived?
   [ 1 ]  [ 2 ]  [ 3 ]  ( 4 )

   [  ADMIT 4  ]
```

One tap for the common case. Two taps for a partial arrival.

**Result screen when partial:**

```
   ✓  3 OF 4 ADMITTED
   Mr & Mrs Adeyemi · Table 12
   1 remaining
```

**Rescan with remaining allowance is not a duplicate.** The fourth family member arriving twenty minutes later is a normal admission, and the picker opens at 1.

**Rescan with nothing remaining:**

```
   ⚠  PARTY FULLY ADMITTED
   Mr & Mrs Adeyemi
   4 of 4 · last admitted 5:32 PM at Main Gate
```

Naming the entrance and the time is what lets staff resolve it — usually the party split up and someone already came through another gate.

---

## 7. Overflow

A party of four sends five people. This will happen constantly at Nigerian weddings.

| `overflow_behaviour` | Behaviour |
|---|---|
| `block` | Hard stop. Manager must raise the allowance from the dashboard |
| `warn_and_allow` *(default)* | Confirmation step, then admit. Logged as `overflow_admitted`, surfaced on the organiser dashboard as it happens |

The dashboard should show a live overflow count during the event. An organiser who sees *"12 parties admitted over allowance"* at 6pm can make a capacity decision while it still matters.

---

## 8. Manual search

Dead phone, no screen, forgotten link — common enough that this is a primary path, not a fallback.

- Search by **name or phone**, three characters minimum
- Results show display name, party size, category, table, and admitted status
- Selecting a result enters the state machine **at step 4 (RSVP gate)** — token checks are skipped
- Logged as `manual`, with the staff member recorded

Manual check-in is the single most abusable action in the system. It is permissioned separately from scanning, and every manual entry appears in the organiser's check-in history flagged as manual.

---

## 9. Walk-ins

Only when `allow_walk_ins` is on **and** the staff member has permission. Creates an invitation and pass on the spot, immediately admitted.

**One rule that must not be broken:** a walk-in that would exceed the plan's pass limit is still admitted. The organiser is warned in the dashboard and settles it afterwards.

Blocking a real human standing at a wedding gate because of a billing threshold is the worst possible failure this product could have. Capacity limits are commercial; the door is not.

---

## 10. Offline behaviour

Everything in §3 runs offline except one thing: `admitted_so_far` is computed from the local log plus the last successful sync.

**Two devices, both offline, same pass.** Both admit. Both write log rows. On sync the server detects the overlap and:

- Marks the rows `contested`
- Notifies the organiser
- **Does not retroactively deny anyone.** The people are already inside; rewriting history helps nobody

This is exactly why the log is append-only and current state is derived. There is no boolean to conflict.

**Staleness indicators the scanner must show:**

| Signal | Display |
|---|---|
| Queued unsynced scans | Count in header |
| Offline | Persistent header strip, not a toast |
| Revocation list older than 15 min | Subtle warning on the scan screen |

A pass revoked while a device is offline will still admit. Accepted risk for V1 — the alternative is refusing entry whenever the network drops, which is far worse.

---

## 11. Undo

Staff mis-tap. "Admit 4" when two arrived is a realistic error and it corrupts the count.

- Available on the last scan for **30 seconds**, and from the recent-check-ins list for the duration of the event
- Never deletes a row. Writes a **reversal row**: `result: reversal`, `reverses_check_in_id`, `admitted_count: -n`
- The derived sum stays correct and the audit trail stays complete

---

## 12. Derived state

```
admitted_so_far = SUM(admitted_count)
                  WHERE pass_id = X
                  AND result IN (admitted, partial, manual,
                                 overflow_admitted, reversal)

remaining = MAX(0, allowance - admitted_so_far)
```

Rows with `result` of `invalid`, `wrong_event`, `revoked`, `rsvp_blocked`, `rsvp_declined`, `allowance_exhausted`, `overflow_blocked` or `not_found` carry `admitted_count: 0`. They are recorded anyway — refused attempts are exactly what an organiser wants to see afterwards.

---

## 13. Open decisions

1. **Undo across devices.** Can a manager undo a scan made on another device? Probably yes, from the dashboard, but it needs a permission and a UI.
2. **Re-entry.** Guests who step outside and return. Currently a rescan with nothing remaining reads as fully admitted, which is technically correct but unhelpful. A `re_entry` result and an optional check-out are the clean fix — deferred to V2, but the log schema already supports it.
3. **Clock skew.** Devices with wrong system time will mis-order the check-in history. Record both device and server timestamps, sort by server time once synced.

---

## Next

With this settled, the scanner screen can be designed directly — twelve outcome states, one count picker, one search view, one offline indicator. That is the whole interface.
