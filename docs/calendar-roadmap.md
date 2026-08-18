# Marvis Calendar — Roadmap

A personal Motion-style calendar/planner: auto-scheduling, task management,
single daily-driver calendar. No team features (assigning to others, shared
workspaces, meeting polls) — this is single-user by design.

v0 (shipped, see `calendar/README.md`): task CRUD, greedy auto-scheduler,
`/calendar` week view with manual events. This doc plans everything after
that.

Reference: FluidCalendar (MIT, cloned locally for architecture reference
only — not vendored) validates a few approaches adopted below: the
`googleapis` package for OAuth + Calendar API instead of hand-rolled token
refresh, and one connected-account row per external calendar rather than a
model per provider.

Google Calendar sync is pushed to the end of this roadmap by request
(Phase 5) — everything else ships first.

## Phase 1 — Calendar views & editing

1. **Day and month views**, not just week — Motion's core views.
2. **Drag-and-drop** on the week/day grid: drag an event to move it, drag
   its edge to resize. Native HTML5 DnD, no new dependency.
3. **Click-to-create**: click/drag on an empty grid slot to open the
   add-event form pre-filled with that time, instead of only the bottom
   form.
4. **Edit-in-place**: click an existing event to edit title/time/notes,
   not just delete.
5. **Recurring events**: add the `rrule` package (recurrence math is
   genuinely easy to get wrong — DST, month-end, leap years — worth the
   dependency) for both manual recurring events and recurring tasks.

## Phase 2 — Smarter auto-scheduling

Upgrade the v0 greedy scheduler toward FluidCalendar's actual model:

1. **Weighted scoring** instead of strict due-date-then-priority sort:
   score candidate slots by due-date urgency, priority, and how close to
   "now" they are, so a low-priority task due soon doesn't always lose to
   a high-priority task due later, or vice versa — tunable weights, not
   hardcoded.
2. **Energy/preferred-time windows**: tag tasks (deep work vs. admin) and
   prefer morning/afternoon slots per tag.
3. **Buffer time** between events, and a **lock** flag on events to
   exclude them from being auto-rescheduled.
4. **Reschedule stale tasks**: a task whose slot got skipped (calendar
   changed underneath it) needs to be noticed and re-placed, not just
   silently stuck at a stale time.

## Phase 3 — Daily-driver features

1. **Focus mode**: a distraction-free single-task view with a timer.
2. **Quick capture**: a fast "add task" entry point (keyboard shortcut,
   maybe natural-language due dates like "tomorrow 3pm").
3. **Projects/labels**: group tasks, filter the task list and calendar by
   project.
4. **Notifications/reminders**: browser notifications before a scheduled
   block starts.

## Phase 4 — Polish

1. Keyboard shortcuts (new task, next/prev week, etc.).
2. Mobile-responsive layout (the grid already scrolls horizontally on
   narrow screens; needs real testing on a phone).
3. Dark/light theme toggle (currently follows OS only).

## Phase 5 — Google Calendar integration

1. **Schema**: add a `GoogleAccount` model (single row for now — one
   Google account, this is a single-user app): `accessToken`,
   `refreshToken`, `expiresAt`, `email`. Add to `Event`: `source` enum
   (`LOCAL` | `GOOGLE`), `googleEventId String? @unique`,
   `googleCalendarId String?`, `updatedAtGoogle DateTime?` (etag/version
   tracking for conflict detection).
2. **OAuth connect flow**: `/api/google/connect` redirects to Google's
   consent screen (`calendar` scope); `/api/google/callback` exchanges the
   code for tokens via the `googleapis` package and stores them. A
   "Connect Google Calendar" button on a new `/settings` page. Setup
   instructions for the Google Cloud OAuth client are in
   `docs/google-calendar-setup.md`.
3. **Import (read)**: pull events from the primary Google calendar into
   local `Event` rows tagged `source: GOOGLE`. Poll on a schedule (Google
   Calendar push notifications/webhooks need a public HTTPS endpoint,
   which a local personal deployment may not have — start with polling
   every few minutes, revisit webhooks once this is deployed somewhere
   reachable).
4. **Export (write)**: local (`LOCAL`) events created here get pushed to
   Google so they show up on your phone/other devices. Auto-scheduled
   task-events count as local events, so scheduling a task also creates
   it on your real Google Calendar.
5. **Two-way sync + conflict handling**: on each poll, diff by
   `updatedAtGoogle` vs local `updatedAt`; last-write-wins is fine for a
   single-user tool — no need for FluidCalendar's multi-provider conflict
   resolution machinery.
6. **Free/busy correctness**: the auto-scheduler must treat imported
   Google events as busy time, same as local events.

## Explicitly out of scope

Team scheduling, shared workspaces, assigning tasks to others, meeting
polls/booking links, multi-user accounts, admin roles — anything from
Motion's team-oriented feature set.
