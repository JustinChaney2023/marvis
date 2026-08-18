# Marvis Calendar — Roadmap

A personal Motion-style calendar/planner: auto-scheduling, task management,
single daily-driver calendar. No team features (assigning to others, shared
workspaces, meeting polls) — this is single-user by design.

All five phases below are built. The one open item is connecting a real
Google Cloud OAuth client (Phase 5) — that needs your Google account, see
"What's left" at the bottom.

Reference: FluidCalendar (MIT, cloned locally for architecture reference
only — not vendored) validated a few approaches adopted below: the
`googleapis` package for OAuth + Calendar API instead of hand-rolled token
refresh, and one connected-account row per external calendar rather than a
model per provider.

## Phase 1 — Calendar views & editing (shipped)

Day/week/month views, drag-and-drop move + resize + create on the hour
grid, click-to-create, edit-in-place, recurring events (`rrule`).

Known v1 scope gap: editing/deleting a recurring event acts on the whole
series, not a single occurrence (no "just this one" exceptions, no series
end date in the UI). Drag/resize is disabled on recurring occurrences for
the same reason. Worth a pass once that limitation is actually annoying in
daily use.

Also shipped a visual pass (indigo accent, cards/shadows/transitions,
segmented view switcher) that wasn't originally scoped here.

## Phase 2 — Smarter auto-scheduling (shipped)

`src/lib/scheduler.ts`: `findBestSlot` scores a bounded window of
candidate slots (energy-window match, due-date urgency) instead of always
taking the very first fit; a 10-minute buffer is padded onto every busy
interval; `Task.energy` (LOW/MEDIUM/HIGH) drives morning/afternoon
preference; `Event.locked` excludes an event from ever being
auto-rescheduled; `rescheduleStaleTasks` (run automatically by "Schedule
all") re-places a scheduled task whose slot has elapsed or now conflicts
with something else.

## Phase 3 — Daily-driver features (shipped)

- `/focus` — single-task view with a countdown timer.
- Quick capture — press `c` anywhere, natural-language parsing
  (today/tomorrow/next `<weekday>`/in N days, a clock time, `p0`-`p3`
  priority shorthand) via `src/lib/quickCapture.ts`.
- Projects/labels — create, filter (`?project=`), colored badges.
- Browser notifications for events starting within 10 minutes (only while
  a tab is open — no service worker/push).

## Phase 4 — Polish (shipped)

- Keyboard shortcuts on `/calendar`: `j`/`k` prev/next, `d`/`w`/`m` view,
  `t` today.
- Mobile-responsive pass (grid min-width now scales with column count
  instead of a fixed 40rem forcing day view to scroll unnecessarily; nav
  rows wrap). Code-level review only — no real device/browser testing was
  possible this session.
- Manual dark/light theme toggle (a `.dark`-class custom variant instead
  of only `prefers-color-scheme`, persisted to localStorage).

## Phase 5 — Google Calendar integration (built, not yet connected)

Schema, OAuth flow, `/settings` page, and two-way sync
(`src/lib/google-sync.ts`) are all in place:

- Import pulls from the connected calendar (past 7 / future 90 days),
  translating Google's RRULE into this app's own recurrence format rather
  than exploding recurring events into hundreds of rows.
- Export pushes anything new or edited more recently locally than its
  last known Google state (last-write-wins via timestamps — fine for a
  single-user tool).
- Deleting an event here deletes it on Google too.
- The auto-scheduler needed zero changes — it already treats every
  `Event` row as busy regardless of `source`.

Known v1 gap: deletions made directly on Google aren't detected on
import (no tombstone handling yet).

### What's left

Connect a real Google Cloud OAuth client — steps in
`docs/google-calendar-setup.md`. Until `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` are set in `.env`, `/settings` shows "not
connected" and the connect flow fails into a friendly error rather than
actually connecting. None of the sync code has been exercised against a
real Google account yet.

## Explicitly out of scope

Team scheduling, shared workspaces, assigning tasks to others, meeting
polls/booking links, multi-user accounts, admin roles — anything from
Motion's team-oriented feature set.

## Ideas noted, not yet planned

You mentioned wanting AI worked into this heavily eventually (this is a
Claude-managed project) — no concrete phase for that yet; worth its own
discovery pass (what would AI actually do here — smarter scheduling
suggestions, natural-language event editing beyond quick-capture, a
chat-driven planning assistant?) rather than bolting it on ad hoc.
