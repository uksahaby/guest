# System Architecture — Revision 2

**Supersedes:** Phase 2F (Data & System Architecture), Phase 2G (Screen Inventory), Phase 3 (Information Architecture) where they conflict.

This revision folds the eight efficiency adjustments into the locked specification. Everything not mentioned here stands as previously agreed.

---

## 1. What changed at the structural level

The single biggest change is that **Invitation** is promoted from a side-object to the central unit of the system, sitting between Event and Guest.

**Before:**

```
EVENT → GUEST → INVITATION → RSVP → QR PASS → CHECK-IN
```

One person, one invitation, one pass. Plus-ones and guest groups were separate mechanisms bolted alongside.

**After:**

```
EVENT → INVITATION (a party of N) → { GUESTS[], PASS, RSVP }
                                        ↓
                                  CHECK-IN EVENTS
```

An invitation is a household, a family, a couple, a corporate team — anything the organiser thinks of as one unit they are inviting. It carries an **allowance** (how many people it admits). Named guests inside it are optional.

This one change absorbs three previously separate features: plus-one management, guest groups, and individual-vs-group QR codes. They are no longer features. They are the default shape of the data.

---

## 2. Revised entity model

```
WORKSPACE
  ├── SUBSCRIPTION
  ├── PAYMENT
  ├── TEAM MEMBERSHIP
  └── EVENT
        ├── ENTRANCE
        ├── TABLE
        ├── CATEGORY
        └── INVITATION
              ├── GUEST        (named person, optional, 0..n)
              ├── PASS         (issued at creation, 1)
              └── CHECK-IN EVENT (append-only log, 0..n)
```

### Invitation

The unit of invitation, of RSVP, of pass issuance, of table assignment, and of check-in.

| Field | Notes |
|---|---|
| `id` | |
| `event_id` | |
| `display_name` | "Mr & Mrs Adeyemi", "The Okafor Family", "John Smith" |
| `primary_phone` | **Primary identifier** (change 7) |
| `primary_email` | Optional |
| `allowance` | Integer, default 1. How many people this invitation admits |
| `category_id` | Groom's Family, Bride's Family, VIP, Colleagues… |
| `table_id` | Nullable |
| `rsvp_status` | `pending` \| `attending` \| `partial` \| `declined` |
| `rsvp_count` | How many of the allowance confirmed. Nullable |
| `delivery_status` | `not_sent` \| `link_generated` \| `sent_email` \| `opened` |
| `invited_at`, `opened_at`, `responded_at` | |

### Guest

A named person belonging to an invitation. **Optional.** An invitation with `allowance: 4` and zero named guests is completely valid and will be the common case at import time.

| Field | Notes |
|---|---|
| `id`, `invitation_id` | |
| `first_name`, `last_name` | |
| `is_primary` | The named contact |

The organiser can name people later if they want table cards or per-person tracking. They are never forced to.

### Pass

| Field | Notes |
|---|---|
| `id`, `invitation_id`, `event_id` | |
| `token` | Signed, self-verifiable (see §3) |
| `status` | `active` \| `revoked` |
| `allowance_snapshot` | Allowance at issue time |
| `issued_at` | |

**Passes are created when the invitation is created** (change 1), not when RSVP is confirmed. Pass status is independent of RSVP status. Whether RSVP gates entry is a per-event policy decision, not a structural one.

### Check-in Event

**Append-only.** This is what makes offline work.

| Field | Notes |
|---|---|
| `id`, `pass_id`, `event_id` | |
| `entrance_id`, `staff_user_id`, `device_id` | |
| `admitted_count` | How many people walked in on this scan |
| `result` | `admitted` \| `partial` \| `allowance_exhausted` \| `invalid` \| `wrong_event` \| `revoked` \| `manual` |
| `scanned_at` | Device clock |
| `synced_at` | Server clock, null until synced |

Current state is **derived**, never stored as a mutable flag:

```
admitted_so_far = SUM(admitted_count) WHERE pass_id = X AND result IN (admitted, partial, manual)
remaining = allowance - admitted_so_far
```

There is no `is_checked_in` boolean to conflict. Two devices that both scan the same pass offline produce two log rows that merge cleanly on sync, and the server flags the over-admission rather than losing data.

### Event — new settings block

| Field | Default | Notes |
|---|---|---|
| `rsvp_required_for_entry` | `false` | Change 1. When false, an invited guest who never RSVP'd still gets in |
| `allow_walk_ins` | `false` | Can scanner staff create an invitation at the door |
| `overflow_behaviour` | `warn_and_allow` | What happens when a party of 4 sends 5 people |

---

## 3. QR token design (change 3)

The token must be verifiable **without a server**, even though offline check-in ships in V2. Retrofitting this later means redesigning both the token and the write path.

**Payload:** `pass_id`, `event_id`, `allowance`, `issued_at`, `version`

**Signature:** HMAC using a per-event secret, held by the server and pushed to each scanner device when it opens the event.

This splits validation into two halves:

| Check | Where | Needs network |
|---|---|---|
| Is this token genuine? | Signature verification | No |
| Is it for this event? | Payload comparison | No |
| Is it revoked? | Revocation list, synced at event open | No |
| How many already admitted? | Local log + synced server log | No (eventually consistent) |

The server remains the authority. The device reconciles. Offline then becomes a client-side feature rather than an architectural rewrite.

The token carries no personal data — no name, no phone, no email.

---

## 4. Plan gating (change 5)

The subscription no longer limits **stored guests**. It limits **issued passes**.

| Counter | Gated | Notes |
|---|---|---|
| `invitations_stored` | No | Unlimited on every plan, including Free |
| `passes_issued` | **Yes** | Free 25 · One-off 500 · Professional per plan |

A pass counts as issued the first time its invitation is sent or its link is opened. Importing a 500-row CSV on the Free plan is allowed and free. The wall appears at **Send Invitations**, after the organiser has done the data-entry work.

**Subscription changes:** drop `guest_limit`, add `pass_limit`. Add a denormalised `passes_issued_count` on Event.

Note that with the household model, "500 guests" now means 500 *people*, summed across allowances — not 500 invitation rows. A ₦5,000 event covering 500 people might be 180 invitations.

---

## 5. Workspace (change 6)

The workspace stays exactly as designed in the data model. Only its visibility changes.

- Auto-created silently at signup
- `is_implicit: true` until the user creates a second workspace or invites a team member
- While implicit: no workspace switcher in the sidebar, no "create your workspace" onboarding step, no workspace naming prompt
- Onboarding goes straight from signup to **Create Your Event**

A couple planning one wedding never learns the word "workspace." A planner with six clients gets the switcher the moment they need it.

---

## 6. Roles (change 7)

Three roles for V1, down from five.

| Role | Scope |
|---|---|
| **Owner** | Everything, including billing and team |
| **Event Manager** | Assigned events: guests, invitations, tables, check-in monitoring, reports |
| **Scanner Staff** | Assigned event + entrance: scan, manual search. No billing, no guest list export, no settings |

"Check-in Manager" is folded into Event Manager as a permission flag. The permission-string system from Phase 2F is retained unchanged so granularity can return without migration.

---

## 7. Invitation delivery (change 4)

WhatsApp is the primary channel for MVP, via deep links — **no Business API, no per-message cost.**

**Send Invitations screen:**

- Per-row WhatsApp button → opens `wa.me/<phone>` with a prefilled message containing the personalised link
- "Copy all links" → CSV or clipboard, for organisers who prefer to send in bulk themselves
- Bulk email → fallback for corporate events where email is the norm
- SMS → V2, paid add-on

**Tracking limitation to design around:** a WhatsApp deep-link send cannot be confirmed server-side. `delivery_status` therefore moves `not_sent → link_generated → opened`. The invitation funnel on the dashboard reports **Links generated / Opened / Responded**, not "Sent / Delivered / Read." Do not build UI that implies delivery confirmation we cannot observe.

---

## 8. Super Admin (change 8)

V1 is three read-only screens plus one action:

1. Platform metrics (users, events, passes issued, revenue)
2. Workspace lookup
3. Payment log
4. Manual subscription override (support tool)

The full admin platform from Phase 2G moves to V2, to be built once there are customers to administer.

---

## 9. Screen inventory — deltas only

### Organiser dashboard

| Screen | Change |
|---|---|
| Guests | Renamed **Guest List**. Rows are invitations, expandable to named guests. Columns: Name, Party, Category, RSVP, Table, Admitted |
| Add Guest | Becomes **Add Invitation**: display name, party size, phone, category, table |
| Import | Columns become Name, Party Size, Phone, Category. Party size defaults to 1 if absent |
| Plus-One management | **Removed.** Absorbed into allowance |
| Guest Groups | **Removed.** Absorbed into invitation |
| QR Passes | Passes exist from creation. Filters: Active / Partially used / Fully used / Revoked |
| Event Settings | New **Entry Policy** section |
| Send Invitations | Rebuilt around WhatsApp deep links (§7) |
| Billing | Upgrade prompt now fires at send time, not add time |

### Scanner — this is where the allowance model bites

New step after a valid scan when `allowance > 1`:

```
        MR & MRS ADEYEMI
        Groom's Family · Table 12

        How many arrived?

            [ 1 ]  [ 2 ]  [ 3 ]  ( 4 )

        [ ADMIT 4 ]
```

Defaults to the full remaining allowance, so the common case is one tap. Result screen shows `3 of 4 admitted · 1 remaining`.

Consequence: **a second scan of the same pass is not automatically a duplicate.** If 1 of 4 remains, the correct response is to admit them. "Already checked in" now means *allowance exhausted*, and the screen must say so:

```
        ⚠  PARTY FULLY ADMITTED
        Mr & Mrs Adeyemi
        4 of 4 admitted · last at 5:32 PM
```

Also required: an offline indicator and a queued-scan count in the scanner header.

### Guest experience

| Screen | Change |
|---|---|
| Invitation | Pass is reachable immediately — no RSVP wall (change 1) |
| RSVP | Still prompted prominently, and asks *how many of your N are coming* |
| Pass | Shows party size: "Admits 4" |

---

## 10. Carried-forward open items

Not blocking, but not yet resolved:

- ₦5,000 for up to 500 people means a 1,500-person society wedding — the highest-value customer — has no product to buy. The larger tiers from Phase 2C were collapsed and need restoring.
- Professional at ₦15,000/month is only 3× the one-off price; a planner doing four weddings a year is better off buying four one-offs.
- The V2/V3 backlog needs updating: seating moved into MVP, plus-ones and guest groups no longer exist as separate features.
