# Commercial Decisions

Settling the two open items: pricing above 500 guests, and the brand name. Both changed shape once I checked current market numbers.

---

## Part 1 — A competitor you need to look at today

**Ekaabo** (ekaabohq.com, Ekaabo HQ Limited, Lagos) is live and is close to the product we've specified. From their own site:

| Our decision | Their status |
|---|---|
| WhatsApp delivery of QR passes (change 4) | Shipped — personalised WhatsApp with unique QR per guest |
| Offline check-in (change 3) | Shipped — guest list downloads to device, syncs on reconnect |
| Walk-ins admitted at the gate (§9) | Shipped — usher adds walk-in, generates pass, checks in |
| Pay-per-event, not subscription | Shipped — <cite index="78-1">priced by guest count, not by month, with no subscriptions</cite> |
| Generous free trial | <cite index="78-1">First event's first 150 guests free</cite> |
| Plus-one / companion handling | Shipped |
| Guest never needs an app | Shipped |

They also have things we deferred: badge generation, multi-day session tracking, a public event portal per event, and Google Sheets sync. Their positioning line is <cite index="78-1">"Every guest, perfectly welcomed"</cite>, and they target <cite index="78-1">weddings, owambes, churches, conferences and corporate events across Nigeria and the diaspora</cite>.

There's also **Eventor Nigeria** doing NFC and QR check-in with offline mode, and **Scan.ng** doing QR event management.

### What this means

Not that the project is dead. But three assumptions we've been working under are now wrong:

**The 25-guest free tier is finished.** Against 150 free, 25 reads as mean. And 150 is a shrewd number — <cite index="69-1">Nigerian weddings routinely run 300+ guests</cite>, so it's generous enough to feel real and still too small to run an actual wedding on.

**Feature-gated tiers are a weak position.** Their line is <cite index="78-1">no feature locked behind a higher price — bigger events just cost less per guest</cite>. Our Free/Starter/Professional feature matrix looks worse beside that, and it's a fight over fairness we'd lose.

**WhatsApp delivery, offline check-in and walk-ins are no longer differentiators.** They're table stakes. Anything we present as novel that they already ship makes us look like we didn't check.

### What is still genuinely ours

Two things, and they're both from decisions made in this project:

1. **The household allowance with partial admission.** Their model appears to be one guest, one code, with companions attached. Ours treats a party of four as the unit and handles "three arrived, one still to come" at the gate. That is a real difference in a country where invitations go to households, and it shows up everywhere — import, the pips column, the count picker, the log.

2. **Time-aware readiness.** Nobody in this market tells an organiser *what to do this week*. It's the difference between a database and an assistant.

Neither is a moat. Both are worth building well.

### The strategic question I'd put to you

Head-on against Ekaabo in Nigerian weddings means beating an incumbent with a head start on their home ground. The alternative is to aim the same platform at **controlled access** rather than celebration — multi-gate events, pass types with different access rights, refused-entry audit trails, security staff with read-only views. That's the Envoy half of the original research, it's where the household model and the check-in log are strongest, and it's a segment (corporate, government, religious, university) that pays more and churns less.

I'd want your call on that before the public website gets designed, because it decides every word on it.

---

## Part 2 — Pricing

### The number that reframes everything

<cite index="63-1">Wedding catering in Nigeria runs ₦5,000 to ₦12,000 per plate, with Lagos at the higher end and a floor around ₦3,000.</cite> <cite index="62-1">The average Nigerian couple spends around ₦13 million across the full wedding, and a mid-scale Lagos wedding runs ₦15–25 million.</cite>

So for a 500-guest Lagos wedding, **food alone is ₦2.5–6 million.**

Charging ₦5,000 to manage that entire guest list is roughly one plate of jollof. It isn't cheap — it's not credible. It signals a weekend project, and it leaves most of the value on the table.

The right mental anchor for a Nigerian couple isn't "software subscription." It's **"less than three plates."**

### Recommended tiers

Priced by **people**, not invitations — a 186-invitation wedding admitting 512 people buys the 600 tier.

| Tier | People | Price | Per head |
|---|---|---|---|
| Free | 150 | ₦0 | — |
| Small | 300 | ₦7,500 | ₦25 |
| Standard | 600 | ₦15,000 | ₦25 |
| Large | 1,200 | ₦25,000 | ₦21 |
| Grand | 2,500 | ₦40,000 | ₦16 |
| Above 2,500 | — | Quote | — |

Every feature on every tier. Bigger events cost less per head. That matches the market's fairness expectation instead of arguing with it.

**Sanity check:** ₦15,000 on a ₦15m Lagos wedding is 0.1% of budget and about three plates of food. <cite index="43-1">Weddings.ng advertises ₦25,000 and ₦50,000 per wedding</cite> for planning, so we sit credibly below the nearest local reference point.

**Payment economics.** <cite index="56-1">Paystack local cards are 1.5% + ₦100, capped at ₦2,000</cite>, <cite index="57-1">with the ₦100 waived below ₦2,500 and 7.5% VAT charged on the fee itself</cite>. On ₦15,000 that's about ₦349, or 2.3%. On ₦7,500, about ₦228, or 3%. Both fine. Note the ₦2,500 waiver — if you ever want a micro-tier for a 50-person event, price it at ₦2,500 and processing is free.

### Professional and Organisation

The old ₦15,000/month was broken: only 3× a single event, so a planner doing four weddings a year was better off buying four one-offs.

| Plan | Price | Break-even |
|---|---|---|
| **Professional** | ₦25,000/mo or ₦240,000/yr | ~16 events/year at Standard |
| **Organisation** | From ₦600,000/yr | Recurring programmes, multi-site |

Professional targets planners doing 20+ weddings a year. **Below roughly 16 events, one-offs are genuinely cheaper and you should say so on the pricing page.** Telling a planner to buy the cheaper thing is worth more in trust than the margin you'd have taken.

Organisation is for churches, mosques, universities and corporates running repeating programmes — the segment where the access-control positioning would land.

**One feature worth building for planners:** let the couple pay for their own event from inside the planner's workspace. Planners hate fronting costs, and it turns every wedding into a customer acquisition.

---

## Part 3 — The name

### Ruling out a lane

Ekaabo means *welcome* in Yoruba. Sannu, Nnọọ and Karibu are the obvious neighbours and would now read as derivative. Skip the whole hospitality-greeting direction.

### Candidates

| Name | The idea | Risk |
|---|---|---|
| **Gatefold** | A gatefold is the fold-out panel of a printed invitation — and it contains *gate*. One word holding both halves of the product | Common printing term; needs trademark search in software classes |
| **Lintel** | The beam above a doorway. Quiet, architectural, unmistakably about entry | No emotional warmth for weddings |
| **Doorlist** | Plainly descriptive: the list at the door | Generic, hard to defend |
| **Threshold** | The line you cross to enter | Long, heavily used |
| **Kola** | The kola nut, presented to welcome guests | Beautiful, but tied to Nigeria in a way that won't travel |

### Recommendation: **Gatefold**

It's the only candidate that carries the invitation *and* the entry in a single real word. It works for a wedding and for a government building. It doesn't age into the wrong category when you expand past weddings, and it isn't in use by anyone in this space as far as I can see.

**Before committing, check:** gatefold.com / .app / .ng availability, Nigerian trademark (classes 9 and 42), EU/UK/US marks, App Store and Play Store names, and the Instagram and X handles. "Gatefold" being a common printing term cuts both ways — harder to trademark broadly, easier to defend in software.

Second choice is **Lintel**, if you take the access-control positioning, where warmth matters less than authority.

---

## What I'd do next, in order

1. **Sign up for Ekaabo and run a test event through it.** An afternoon. You'll learn more about your competitive position than any further research I can do.
2. **Decide the positioning question** — weddings head-on, or controlled access.
3. **Run the name checks** on Gatefold.
4. Then the public website, which is currently blocked on all three.
