# Event Readiness — Rules

**Feeds:** Organiser dashboard (Phase 4B §9, §10)

---

## The change I'm proposing

Phase 4B specified a percentage: *"Event Readiness — 82%."*

I'd drop it. A percentage answers a question nobody asked. It also lies — an event at 95% with no scanner staff assigned is less ready than one at 60% with everything except table assignments, because one of those fails at the gate and the other is a seating inconvenience.

**Replace it with time.** Every check has a window in which it starts mattering and a point at which it becomes urgent, both anchored to the event date. The dashboard then answers the only question an organiser actually has:

> What do I need to do about this today?

Twelve weeks out, an unassigned guest list is normal. Three days out it's a problem. The same fact, different urgency — and only the calendar knows which.

---

## The checks

| # | Check | Passes when | Starts mattering | Urgent at | Resolving action |
|---|---|---|---|---|---|
| 1 | Event details | Name, date, venue set | At creation | Before any invitation sends | Finish event setup |
| 2 | Guest list started | ≥ 1 invitation | At creation | 8 weeks out | Add or import invitations |
| 3 | Invitations sent | ≥ 90% have a link generated | 6 weeks out | 3 weeks out | Send remaining invitations |
| 4 | Replies in | ≥ 80% responded | 3 weeks out | 10 days out | Send reminders to non-responders |
| 5 | Tables assigned | 0 confirmed guests unassigned | 2 weeks out | 3 days out | Assign remaining guests |
| 6 | Gates created | ≥ 1 entrance | 1 week out | 2 days out | Add an entrance |
| 7 | Staff assigned | ≥ 1 scanner staff on the event | 1 week out | 2 days out | Invite check-in staff |
| 8 | **Test scan done** | ≥ 1 scan by assigned staff | 3 days out | 1 day out | Ask staff to open the scanner and test |
| 9 | Pass capacity | Passes issued ≤ plan limit | Any time | On breach | Upgrade, or continue and settle after |

Checks 5–8 only apply if the relevant feature is switched on — an event with table management off never shows check 5.

---

## Check 8 deserves a note

Staff who have never opened the scanner will fumble at the gate in front of a queue. It is the single cheapest failure to prevent and no competitor prompts for it.

The check passes on **any** scan by an assigned staff member — a test pass the organiser sends them is enough. Two days before the event, if nobody has opened the app, the dashboard should say so plainly.

---

## Headline state

Not a percentage. One of four words, derived from the checks that are currently urgent:

| State | Condition |
|---|---|
| **Setting up** | Checks 1–2 incomplete |
| **On track** | Nothing urgent |
| **Needs attention** | ≥ 1 urgent check failing |
| **Ready** | All applicable checks pass, within 7 days of the event |

After the event: **Complete**.

---

## Ordering the list

Outstanding items sort by **urgency date**, not by check number. What's due soonest is at the top, and anything past its urgent point is separated above the rest under *Due now*.

Everything not yet in its window is hidden entirely, not greyed out. Showing an organiser twelve weeks of future tasks on day one is how a dashboard becomes something people stop opening.

---

## Copy rules

Each item states the fact and the action, in that order, with the number first:

- *24 confirmed guests have no table* → **Assign tables**
- *31 households haven't replied* → **Send reminders**
- *No one has tested the scanner* → **Invite staff to test**

Never: "Your event is 82% ready." Never a progress bar as the primary signal. The number in the sentence is the progress bar.
