# Overnight session — Aug 18, 2026

You asked me to iterate autonomously overnight: research what Motion users
actually want, consider your context (CS student, part-time tech job,
building a side business), implement as much as I could, use Fable to
double-check things, set up Playwright to test myself, and write up
everything for you to read this morning. This is that writeup. Every
commit tonight is in `git log` in the `calendar` directory with detailed
messages — this doc is the summary, that's the detail if you want it.

**Read this whole thing before using the app today** — three of the bugs
found tonight were serious enough that I'd have wanted to flag them even
outside an autonomous run. One of them (below) was live and about to fire
on your real Google Calendar the next time you hit "sync" — it's fixed,
but read it.

## The bug that mattered most: Google sync was about to strip your real events

A third independent review (Fable, after the two below) found the sync
code's "has this changed since last sync?" check was broken in a way that
made **every one of your 12 real synced events** (classes, work shifts,
Sleep, the Fairbanks trip, your dentist appointment) look locally edited,
permanently, even though you never touched them. I confirmed this against
your live DB before fixing anything: all 12 had the "dirty" flag set.

Pushing a "dirty" event to Google uses a full-replace API call with only
title/start/end/recurrence in the body — every field it doesn't mention
(description, location, reminders, attendees) gets wiped. The very next
sync would have gutted your Dentist Cleaning event's details, then almost
certainly failed outright on the first recurring class it hit next,
because recurring exports were also missing a required timezone field.

Fixed by replacing the broken updatedAt-based check with a real "was this
actually edited locally" flag, set only by your own edits and cleared once
a push succeeds, and by adding the missing timezone. Also fixed while in
there: one failing event no longer aborts the whole sync batch; an event
deleted on Google no longer permanently wedges every future sync; a
Google-side edit to one occurrence of a recurring series no longer imports
as a confusing duplicate; all-day events (your trips) were rendering a day
early because of a UTC/local date mix-up. I verified the live DB directly
before and after — all 12 events now show as clean, not dirty — and ran
your full test suite (all still passing). No calls were made against your
real Google account during the review; this was found by tracing the code
and checking database state only.

**What I didn't build tonight:** proper preservation of single-occurrence
edits/deletions within a recurring series synced from Google (e.g. you
skip one class on Google — that exception is currently skipped on import
rather than round-tripped). That's a bigger feature; flagging it as a
known gap rather than a live risk.

## The two other bugs that mattered most

1. **Every recurring event/task in this app would have drifted an hour
   after Daylight Saving Time ends (Nov 1).** The `rrule` library computes
   recurrence purely on a date's UTC calendar fields, with no concept of
   "local wall-clock time" — I was handing it real local times, so each
   occurrence was actually a fixed UTC instant, not a fixed local time.
   I confirmed this against your actual synced data: your CSCE A490 class
   (Mon/Wed 2:30pm) would have shown at 1:30pm from Nov 2 onward, and your
   daily Sleep block would have shifted the same way. Fixed with the
   standard workaround (relabel local time as fake-UTC before handing it
   to rrule, consistently for the start time, any UNTIL date, and the
   query range) and re-verified directly against your real class event —
   it now stays at 2:30pm across the transition.
2. **Opening one of your synced class events in the calendar and saving
   any unrelated change — even just retyping the title — would have
   silently deleted its end-of-semester cutoff and turned "Mon/Wed until
   Dec 13" into "every Wednesday forever."** And because Google sync
   pushes local edits back, that corruption would have landed on your
   real Google Calendar too. The edit modal has no UI for the `UNTIL`/
   `WKST` parts of a Google-style rule, and was silently rebuilding the
   rule from empty state on every save. Fixed to leave an unrecognized
   rule completely untouched unless you actually interact with the
   Repeat control, with a visible warning when that's the case. Wrote an
   automated test that seeds your exact real rule shape, retitles it, and
   checks the rule survived.

Both were found by having a second model (Fable) do an independent review
of the scheduling/recurrence engine specifically, after the first review
(of the new public booking page) went well enough that I asked it to look
at the core logic too. Neither bug had triggered yet — you just hadn't
hit DST or re-opened a class event yet. Full findings and what I chose
*not* to fix, near the bottom.

## Other real bugs fixed (found by using your actual synced calendar data)

- **Multi-day/all-day events only rendered on their first day.** Your "LA
  Trip?" (Oct 21-24) and "Fairbanks" (Aug 13-18) both vanished after day
  one, in month and week views. Two stacked bugs: the DB query only
  matched events *starting* in the visible range (missing ones that
  started earlier but still overlapped it), and rendering matched events
  to days by exact-date equality instead of interval overlap. Also gave
  all-day events their own banner row instead of squeezing them into an
  hourly block. A related, narrower version of the same bug (a *recurring*
  event spanning more than 2 days) was fixed later in the same pass.
- **"+ New event" could create an invisible event.** Clicking it between
  roughly midnight and 6am picked the literal current time with no
  clamping to the visible 6am-10pm grid — the event saved correctly but
  rendered nowhere. There was also a narrower edge case in the same
  function: clicking between 11:31pm and midnight rounded the time up
  into the *next* day's minute-zero but then `%24`'d the hour back down,
  landing the event that morning instead — i.e. in the past. Both fixed.

## New features, prioritized from researching what Motion users actually want

I searched Reddit, review sites, and "why I switched away from Motion"
posts for what people praise and specifically wish it did differently,
then weighed that against your context (a single-user tool, no team
features, a student with real classes/sleep/work-shift already in your
calendar, trying to also run a side business).

**What people praise:** auto-scheduling that kills decision fatigue,
auto-rescheduling when plans change, a "reschedule all" button, protected
focus time, and — specifically called out by solo founders and
freelancers — **a public booking-link page**. **What people complain
about:** feature bloat instead of fixing basics, pricing/tier walls,
**same-project work getting scattered into interleaved 1-hour blocks
instead of batched together**, a short ~2-week planning horizon,
re-picking project/context on every single task, and a heavy manual-entry
burden for a school term's worth of assignments.

Built from that, roughly in priority order:

1. **Public booking page** (`/book/<your-slug>`) — the one most worth
   trying yourself, and most directly useful for the business side.
   Configure it in Settings: enable, pick a URL slug, a title, a
   duration. Visitors see your real open slots (computed from the exact
   same availability logic the auto-scheduler uses — a visitor can never
   book over something the scheduler would place a task into, or vice
   versa) and book one, which becomes a **locked** event on your calendar
   automatically. **Because sharing this link makes the page's whole JS
   bundle public, I added an authentication gate for everything else in
   the app first** — see "Before you share that link" below, this needs
   one step from you.
2. **Batch/cluster scheduling by project** — the auto-scheduler now
   prefers placing a task on a day that already has another task from the
   same project scheduled, instead of pure earliest-fit interleaving.
   Directly answers the #1 complaint found. (Building this surfaced its
   own bug — a too-aggressive "jump to the next day" search step that
   could skip a genuinely better same-day slot — found and fixed in the
   same review pass as the DST/corruption bugs above.)
3. **Recurring tasks** — a task can now repeat (Daily/Weekly/Monthly/
   Yearly); marking one done creates the next occurrence with the same
   due-date offset, project, priority, and duration. Lighter than a full
   "task template" (no sub-steps), but covers the "recurring structure"
   need without the bigger lift a real template system would need.
4. **Sticky last-used project** on the add-task form — no more re-picking
   your course/project on every single task.
5. Duration inputs (tasks and now booking duration) show their unit and
   offer a native dropdown of common presets (5/10/15.../120 min) while
   still accepting anything typed in.
6. Energy (the manual Low/Medium/High picker per task) was removed from
   the UI per your note — the field and scheduler logic are still there
   underneath, doing nothing (defaults to "no preference"), ready for
   whenever you want to revisit it as something derived automatically
   (e.g. from sleep data) instead of hand-picked.
7. The calendar is now the home page (`/`); Tasks moved to `/tasks`,
   since you said the calendar is what you'll actually live in day to
   day.

### What I deliberately didn't build

- **Calendar/LMS import (Canvas/Blackboard, generic .ics)** — a real
  documented pain point ("1-2 hours per class" of manual entry), but you
  already solved your own version of it by connecting Google Calendar
  directly. Worth reconsidering if you add courses you don't want to
  hand-enter.
- **Multi-step task templates** (e.g. "reading → quiz → discussion" per
  week) — recurring tasks (above) cover the simpler case; a real template
  system with sub-steps is a bigger, separate feature.
- **AI features** — you mentioned wanting AI worked in heavily eventually.
  Deliberately untouched tonight; this deserves an actual conversation
  about what you want it to *do*, not something bolted on ad hoc at 4am.
- Anything shaped like what Motion users specifically resent it for
  chasing instead of fixing basics (AI employees, meeting notes,
  Slack/enterprise integrations), or any team/collaboration feature —
  skipped on purpose, out of scope for this app.

## Before you share that booking link

The public booking page is genuinely public — and once you share it,
its page bundle is public too, and **every other action in this app**
(delete an event, disconnect Google, change settings, ...) turned out to
be reachable by anyone who reads that bundle, not just the booking one,
since nothing in this app had any authentication at all. I had Fable
specifically review the new public surface for exactly this kind of
thing, and fixed everything it found:

- **Added a password gate** (`src/middleware.ts`) for everything except
  `/book/*` and the login page. **It's off by default right now** — I
  didn't want to lock you out with no password to give yourself — you
  need to set `APP_PASSWORD` in `calendar/.env` before you ever share the
  booking link. I tested the actual gate end-to-end (wrong password
  rejected, correct password grants access, persists across navigation)
  with a throwaway test password, then removed it so your app stays
  open for you this morning.
- **A visitor could have booked 3am on a Sunday, or a year in the
  future** — the booking code only checked "doesn't overlap something,"
  not that the submitted time was an actual offered slot. Fixed to
  re-derive the slot from what was submitted and reject anything that
  doesn't match, plus reject anything past the 2-week horizon. Verified
  both of those exact exploits are now rejected.
- **No rate limit or length caps** — a trivial script could have spammed
  bookings, each one landing on your real synced Google Calendar as junk
  you'd have to clean up one by one. Added a per-IP limit (5/hour) and
  caps on name/email/notes length.
- **The double-booking protection had a small race window** — two
  people submitting within milliseconds of each other could both have
  passed the "is this still free" check before either write landed.
  Serialized it so that can't happen.

None of this required a real user-account system — it's all proportionate
to "one person's personal tool with one public page," not enterprise
security theater.

## Decisions I made without asking (sanity-check these)

- Booking defaults to **disabled**; you turn it on and pick a slug in
  Settings.
- A booking creates a **locked** event, so the scheduler never moves it.
- `APP_PASSWORD` is unset (auth off) — the safe default until you set
  one, but also means it's genuinely off right now.
- Project clustering is a soft +5 preference, below the +10 energy-match
  bonus — it won't override a bad-energy slot or blow past a due date
  just to batch things.
- I verified (not just assumed) that treating a multi-day all-day event
  as "fully busy" doesn't cause the scheduler to repeatedly evict and
  re-place a task every time it runs — it corrects once, then stays
  fixed. Left as-is.
- I never touched your real synced Google events except to read them
  while hunting bugs. Every test used a `[e2e]`-prefixed title and got
  cleaned up immediately after (there's a dev-only cleanup route for
  exactly this, guarded against ever running in production).

## Testing

Set up Playwright (`npm run test:e2e`) since I don't have a working
browser tool this session. 7 specs, all passing as of the last commit,
covering: event creation, custom weekly repeat (create + reopen +
verify), the locked toggle, project stickiness, a real booking
submission plus the 404 case, and the recurrence-preservation fix. Every
feature above was verified this way or by running the actual functions
against the real dev DB directly — not just read over.
