# Season — feature inventory

Status as of 2026-10-30, after the audit-driven fixes in PRs #76–#81.
**OK** = implemented and behaving; **Partial** = works but with a known gap;
**Cosmetic** = UI exists but doesn't change behavior.

## Calendar

| Feature | Where | Status |
| --- | --- | --- |
| Day / week / month views, drag to move/resize/create | `app/page.tsx`, `calendar/CalendarClient.tsx` | OK |
| Phone layout: agenda list, month dots, tap a day to open it | `CalendarClient.tsx` (AgendaView, MonthCell) | OK |
| Recurring events, edit this / following / all | `actions.ts` (updateEvent*), `lib/recurrence.ts` | Partial — editing "all" with a new time doesn't shift existing exceptions |
| Event types: Focus time, Out of office | `Event.eventType` | Partial — OOO blocks scheduling for all-day; Focus is a label |
| Locked events (scheduler never moves them) | `Event.locked` | OK |
| Guests + RSVP links | `/rsvp/[token]` | OK |
| Search, reminders (in-tab + push), meeting banner, fullscreen timer | `CalendarSearch`, `NotificationWatcher`, `push.ts`, `MeetingBanner`, `/timer` | OK (`/timer` only reachable from an event or the logo mid-event) |
| ICS import / export | `lib/ics.ts`, `/api/ics/export` | Partial — re-importing the same file duplicates |
| Shared calendars (see a teammate's busy/details) | `CalendarShare`, Settings → Calendars | OK |
| "Needs attention" (overdue / due soon, unscheduled) | right sidebar; strip on phones | OK |

## Tasks & auto-scheduling

| Feature | Where | Status |
| --- | --- | --- |
| Quick capture with shorthand (`essay fri 3pm 2h !! #english`) | `QuickCapture.tsx`, `lib/quickCapture.ts`, Tasks inline bar | OK |
| Full task form (title shorthand fills fields) | `tasks/TaskModal.tsx` | OK |
| List / board / table views, subtasks, labels, attachments, activity, undo complete | `app/tasks/*` | OK |
| Auto-scheduler: working hours, buffers, energy windows, project clustering | `lib/scheduler.ts` | OK |
| Most-urgent-first placement (least slack: due date minus work left) | `compareUrgency` | OK |
| Bumping: a task that would miss its due date moves less urgent blocks (later due date or none; soft never bumps hard; locked/in-progress blocks never move) | `scheduleTask`, `canBump` | OK |
| Chunking (split a 3h task into 1h blocks) | `Task.chunkMin` | OK — re-planning only covers the time not yet tracked on the task |
| Hard vs soft deadlines | `Task.hardDeadline` | OK (ordering + finish-by-deadline scoring) |
| Dependencies ("blocked by") | `Task.blockedBy` | OK — finishing a blocker places the freed tasks right away (with Auto-schedule on); cycles are refused |
| Daily cap ("breathing room") | `AppSettings.dailyCapMin` | OK |
| Time slots (e.g. "School" hours for some tasks) | Settings → Scheduling | OK |
| Stale/conflict re-planning | `rescheduleStaleTasks`, `rescheduleConflictsWith` | OK (on Schedule all, on event create/move, and every 10 min with Auto-schedule on) |
| Auto-schedule (hands-off planning) | Settings → Scheduling, `lib/autoPlan.ts` | OK |
| Deadline risk ("Finishes late") | TaskRow badge, Needs attention, Claude's overview | OK |
| Recurring tasks | `taskOps.setTaskDone` | OK |
| Delay / push to tomorrow | TaskRow, Focus shutdown | OK |
| Habits (N times a week) | Settings → Habits, `lib/habits.ts` | Partial — weekly top-up runs with Auto-schedule (or Settings/Schedule all); disabling leaves future blocks |
| Automations (on status change: notify, generate subtasks, draft email, mark urgent) | `lib/automations.ts` | OK |
| Project templates, syllabus import, AI project/subtask generation | `tasks/import`, `generate-project` | OK |

## Focus

| Feature | Status |
| --- | --- |
| Today's queue with timer, mark done / skip | OK |
| AI one-line daily agenda | OK (needs an AI key) |
| Shutdown ritual (review leftovers, push to tomorrow) | OK |

## Projects

| Feature | Status |
| --- | --- |
| Projects list + detail (notes, files, recordings, vocabulary) | OK |
| Gantt / project timeline, weekly time-tracking | OK |

## Booking & people

| Feature | Status |
| --- | --- |
| Booking links (duration, min notice, max per day, no-meeting days) | OK |
| Group meeting finder (`/meet`) | Partial — only the requester gets the event |
| Team / assignees (incl. "AI employee") | Cosmetic — assigning doesn't change whose calendar a task lands on |

## Integrations

| Feature | Status |
| --- | --- |
| Google Calendar two-way sync, multiple accounts | OK — see `docs/google-calendar-setup.md`; moved single occurrences on Google still show at the original time |
| Apple Calendar (CalDAV, read-only) | Partial — recurring overrides share a UID with the series; a failed calendar fetch can prune its events |
| ICS subscriptions (read-only; optional "import as tasks") | Partial — same recurring-override UID issue |
| Web push notifications, installable phone app | OK |
| Recordings → transcript → summary → tasks | OK (needs a transcription endpoint) |

## Claude & API

| Feature | Status |
| --- | --- |
| MCP server (16 tools, 3 prompts), OAuth sign-in | OK — `docs/mcp.md` |
| REST API `/api/v1` with personal access tokens | OK |
| In-app chat that proposes actions | OK (needs an AI key) |

## Account

Working hours, timezone (server follows the owner's), sessions, tokens,
admin feedback inbox, password reset (needs SMTP), invite-code signup — OK.

---

# Recommendations (compared with Motion and Calendly)

Season already covers Motion's core loop (tasks → auto-scheduled blocks
around meetings, deadlines, re-planning) and Calendly's basics (booking
links with notice/limits). The biggest gaps, in priority order:

## Do next (high value, fits the current design)

1. **Deadline-risk warnings (Motion's signature).** Flag a task whose
   scheduled block ends after its due date — "won't make it by Fri" — on
   the task, in Needs attention, and in Claude's overview. *(Implemented
   in this round — see the PR after this doc.)*
2. **Automatic re-planning.** Motion re-plans continuously; Season only
   does it when you press Schedule all or create/move an event. Run the
   stale sweep + place new tasks in the background (the push loop already
   ticks every minute), behind an "Auto-schedule" setting.
   *(Implemented in this round.)*
3. **Booking confirmations for the invitee.** An email with an .ics
   attachment and a **reschedule/cancel link** — the first thing Calendly
   users expect. SMTP support already exists.
4. **Auto-add a video link to bookings** (Google Meet via the connected
   Google account's `conferenceData`, or a fixed Zoom link per booking link).
5. **Unblock-on-finish.** When a blocker is completed, place the tasks it
   was blocking right away. *(Implemented with the scheduler rework.)*

## Next tier

6. **Booking questions** (custom fields on the booking form) and
   **per-link buffers** before/after meetings.
7. **Visitor timezone picker** on the booking page (now grouped by the
   visitor's zone, but they can't switch).
8. **Assignees that mean something:** schedule a task onto the assignee's
   calendar when they're a Season user (round-robin later).
9. **Workload view:** a week bar chart of scheduled hours vs. capacity
   per day (Motion's "capacity" view), using the daily-cap math.
10. **Moved Google occurrences:** import modified single instances as
    override events (needs EXDATE-aware export to avoid deleting them).

## Later / maybe

- Collective & round-robin booking links (Calendly Teams).
- Payments on booking links (Stripe).
- Routing forms ("pick a meeting type based on answers").
- Email/SMS reminders to invitees.
- A "Today" home screen on phones that merges agenda + next tasks
  (today Focus covers most of it).
