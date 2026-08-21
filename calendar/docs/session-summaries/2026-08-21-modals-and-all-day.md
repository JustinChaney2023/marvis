# 2026-08-21 — Modal layout + all-day events

Two fixes to the calendar app, both now shipped and type-checked/tested clean.

## What changed

**Event/Task modals were taller than the screen**
- `EventModal.tsx` and `TaskModal.tsx` were a single narrow (`max-w-md`) column of
  stacked fields — on smaller/shorter screens the Save/Cancel buttons ran off the
  bottom.
- Widened both to `max-w-2xl` and regrouped fields into 2-column grids: Title +
  Meeting link, Color + Event type, Start + End (EventModal); Project + Assignee,
  Color + Min chunk (TaskModal).
- `EventModal` now has the same `max-h-[85vh] overflow-y-auto` safety net
  `TaskModal` already had, so it can never run off-screen again regardless of
  window height.

**All-day events**
- `Event.allDay` already existed in the Prisma schema and was fully wired through
  Google/Apple/ICS sync and the calendar's all-day banner row — there was just no
  way to *set* it by hand.
- Added an "All day" checkbox to `EventModal`. Checking it swaps the time inputs
  for date-only pickers (end shown as the inclusive last day); on submit, the
  stored `end` is normalized to the exclusive day-after, the same convention the
  sync code and the all-day layout math already assumed — no display code had to
  change.
- Wired through `createEvent`, `updateEvent`, `updateEventOccurrence` in
  `src/app/actions.ts` via a new `allDayFromFormData` helper (same shape as the
  existing `locked` checkbox handling).

## Where this is logged long-term
Full write-up (with the same detail Motion-competitor sessions get) is in
[`docs/motion-feature-backlog.md`](../motion-feature-backlog.md) under
"Modal layout + all-day events (2026-08-21)" — that file is this repo's running
log of every feature session, cross-referenced with GitHub issues on
[JustinChaney2023/marvis](https://github.com/JustinChaney2023/marvis).

## What's next
An overnight self-paced session is now running (see the loop set up right after
this): full Google Calendar feature-parity audit (this app is a Google Calendar
replacement/overlay, so "missing vs. Google" is the priority bar, not just
"missing vs. Motion") plus a fresh competitor pass, filing GitHub issues for real
gaps and implementing the highest-value ones — following the exact process
already established in `docs/motion-feature-backlog.md`'s past sessions
(research → file issues → implement → update the doc → commit locally, never
push, `tsc`/`npm test` clean before each commit).
