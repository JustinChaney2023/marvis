# Overnight session — Aug 18, 2026

You asked me to iterate autonomously overnight: research what Motion users
actually want, consider your context (CS student, part-time tech job,
building a side business), implement as much as I could, and write up
everything for you to read in the morning. This is that writeup.

**Read this before touching anything** — a few items need a decision from
you before they're fully "done."

## What's fixed (real bugs, found using your actual synced data)

1. **Multi-day/all-day events only showed on their first day.** Your
   "LA Trip?" (Oct 21-24) and "Fairbanks" (Aug 13-18) both vanished after
   day one, in both month and week views. Root cause was two stacked bugs
   — the calendar page's DB query only matched events whose `start` fell
   in the visible range (missing anything that started earlier but still
   overlapped), and the rendering matched events to days by exact-date
   equality instead of interval overlap. All-day events now get their own
   banner row above the hour grid instead of being squeezed into an hourly
   block. Fixed and unit-tested against the actual date ranges.
2. **"+ New event" could create an invisible event.** Clicking it in the
   middle of the night (which is roughly when I was testing) picked the
   literal current time with no clamping — an event created at 4am simply
   never rendered anywhere on the 6am-10pm grid, even though it was
   correctly saved. Now clamps into the visible hour window.
3. A dev-server stability issue (Turbopack's persistent cache crashed
   after repeated interrupted restarts) that was silently swallowing
   requests — not an app bug, but worth knowing the dev server needs a
   clean `.next` wipe if it ever seems to "just stop responding."

## What's new

### Testing infrastructure
Set up Playwright (`npm run test:e2e`) since I don't have a working
browser tool this session — a dev-only `/api/test/cleanup` route deletes
only rows with a `[e2e]` title prefix, so tests can run against the real
dev DB (which now has your actual synced Google data) without ever
touching it. All new features below were verified this way, not just
read over.

### From researching Motion (sources in the research itself, ask if you
want them re-surfaced)
What people praise: auto-scheduling that kills decision fatigue,
auto-rescheduling on disruption, a "reschedule all" button, focus-time
blocking, **a public booking-link page** (praised specifically by solo
founders/freelancers), task templates. What people complain about:
feature bloat instead of fixing basics, pricing/tier walls, **same-project
work getting scattered into scattered 1-hour blocks instead of batched**,
a short ~2-week planning horizon, re-picking project/context on every
task, and a high manual-entry burden for a school term's worth of
assignments.

Built from that:
- **Batch/cluster scheduling by project** — the auto-scheduler now
  prefers placing a task on a day that already has another task from the
  same project scheduled, instead of pure earliest-fit interleaving.
  Directly answers the #1 complaint found.
- **Public booking page** — `/book/<your-slug>`, configurable in
  Settings (enable, slug, title, duration). Visitors see your open slots
  (computed from the exact same availability logic the scheduler uses)
  and book one; it becomes a locked event on your calendar. **This is the
  one built tonight most worth trying yourself** — it's the feature most
  directly useful for the "building my own business" side of things
  (client calls, tutoring, freelance work).
- **Sticky last-used project** on the add-task form — no more re-picking
  your course/project on every single task.

## What I did NOT get to / deliberately skipped

- **Calendar/LMS import (Canvas/Blackboard, generic .ics)** — the
  research flagged this as a real pain point ("1-2 hours per class" of
  manual entry), but you already solved your own version of this problem
  by connecting Google Calendar directly, so I judged it lower priority
  than actually-missing things. Worth reconsidering if you add more
  courses/semesters and don't want to re-enter them by hand each time.
- **Recurring task templates** (e.g. "reading → quiz → discussion" per
  week) — good idea, bigger lift, didn't get to it.
- **AI features** (chat-driven planning, natural-language event editing
  beyond quick-capture) — you mentioned wanting AI worked in heavily
  eventually. I didn't touch this — it deserves its own real discovery
  conversation about what you actually want it to *do*, not something to
  bolt on ad hoc overnight.
- Anything AI/enterprise/team-feature-shaped that Motion users
  specifically resent it for chasing (AI employees, meeting notes,
  Slack/enterprise integrations) — skipped on purpose, doesn't fit this
  app or your stated scope.

## Decisions I made without asking (you should sanity-check these)

- Booking page defaults to **disabled** — you have to explicitly turn it
  on and set a slug in Settings before `/book/<slug>` does anything but
  404.
- A booking creates a **locked** event automatically, so the scheduler
  will never move it.
- Project clustering is a soft preference (+5 score, below the +10
  energy-match bonus) — it won't override a genuinely bad-energy slot or
  blow past a due date just to batch things.
- I did not touch anything related to your actual synced Google events
  beyond reading them to find bugs — no test data was ever mixed with
  your real calendar.

## Everything committed tonight

Check `git log` on the `calendar` directory for the full list with
detailed messages — I committed after each logical chunk of work, not in
one big dump, so you can see (and revert, if you want) individual pieces
independently.
