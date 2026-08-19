# Motion replica — feature backlog

Working list of what Motion actually does. Check marks = already in this
app. Open items are also tracked as GitHub issues under
[JustinChaney2023/marvis](https://github.com/JustinChaney2023/marvis),
labeled `calendar` (this repo covers more than just the calendar app) —
this doc is the detailed running log, the issues are the at-a-glance
tracker.

## Competitor research session (2026-08-19, second pass)
Shipped issues #6, #8, #9 (scoped to Apple only), #11, #12, #13, #17, #18,
#19, #21, #22, #24 this session (see each issue's closing comment for
detail/verification). #16 (meeting notetaker) deferred — needs a real
audio/transcription pipeline. #20 (Zoom/Slack/Gmail) still blocked on
OAuth app registrations only the account owner can create.

Went looking beyond Motion itself for what's still missing, comparing
against its direct competitors (Reclaim.ai, Sunsama) since Motion's own
review sentiment (G2/Capterra 2026) repeatedly flags "limited project
management," "no real answer for information overload," and "advanced
reporting" as gaps — not things Motion does better, so worth looking at
who does. New issues filed:
- #26 **Habits** (Reclaim.ai) — flexible recurring routine time-blocking
  that reschedules itself around conflicts, distinct from both fixed
  recurring events and the current one-task-at-a-time recurring-task
  model.
- #27 **Daily overcommitment warning** (Sunsama) — a visible "7h planned
  of a 6h day" nudge when manually adding tasks, vs. the existing
  `dailyCapMin` which only silently gates the *auto-scheduler*.
- #28 **Daily shutdown ritual** (Sunsama) — end-of-day review/carry-over
  flow, the natural closing counterpart to the daily agenda summary (#12).
- #29 **Mobile agenda view** — chronological list instead of the hour
  grid below ~640px, per calendar-UI best-practice research (grids stop
  being actionable below ~360px).
- #30 **Time-tracking report** — weekly tracked-minutes-by-project
  rollup; the data (`Task.trackedMinutes`) already exists, this is one
  view on top of it, not a new analytics subsystem.

Also researched calendar-specific UI/UX best practices (event-overflow
handling, mobile date-picker patterns, information-density layering).
Confirmed this app's month view already does the standard "+N more"
overflow pattern correctly — no gap there.

## UI improvement session (2026-08-19)
Researched real Motion user feedback (G2, Capterra, Forbes Advisor,
ClickUp's comparison review, Trustpilot/Reddit sentiment surfaced via
those sources — direct Reddit fetch was blocked by robots policy) for
both missing features and UI/UX complaints. Findings became GitHub
issues #10–#22 (new feature ideas) and #21/#22 (mobile audit, drag-drop
performance) specifically. Two quick wins shipped immediately:
- [x] Shared `Button` component (`src/app/ui/Button.tsx`) — replaced 23+
      copy-pasted button className strings across 14 files with
      primary/secondary/outline/danger/ghost variants, wired to
      `useFormStatus` so every server-action form button now shows a
      real pending state instead of nothing happening while a submit is
      in flight. Full details/scope on closed issue #23.
- [x] Removed dead `--background`/`--foreground` CSS custom properties
      in `globals.css` — create-next-app boilerplate that nothing read;
      real theming was always the Tailwind classes on `<body>` in
      `layout.tsx`. Closed issue #25.

Validated by research, not changed: the day-by-day calendar-first view
(vs. a spreadsheet-like table) and the prioritized task list are both
specifically praised patterns in Motion reviews — keep doing them,
don't second-guess this app's existing direction there.

## Accounts / team
- [x] Real per-person accounts (email + password, DB-backed sessions) —
      replaces the old single shared-password gate
- [x] First signup on an instance adopts any pre-existing single-user
      data and becomes the admin
- [x] "AI employees" as an assignee type — a Task can be assigned to a
      Human or an AI-labeled Assignee (`/team`); shows on the task list
      and is a real filter/field everywhere tasks are edited. No
      autonomous execution yet — that's a deliberate later step once
      you've decided what "the AI does the task" actually means per task
      type (see "Explicitly out of scope" below)
- [x] Change password (Settings → Account) for a signed-in user
- [x] Login rate limiting (8 attempts / 15 min per IP, same pattern as
      the booking page's limiter)
- [ ] "Forgot password" reset via emailed link — needs an email
      provider (SMTP/Postmark/Resend/etc.) picked and configured first;
      change-password above covers "I'm logged in and want a new
      password", not "I'm locked out"
- [ ] Real invite flow / access control beyond "anyone can sign up" —
      fine while this isn't public; revisit before sharing the DNS

## Calendar view
- [x] Week/day/month views, keyboard nav (j/k, d/w/m, t)
- [x] Full 24h scrollable grid (not clamped to business hours), styled
      scrollbar
- [x] Today column highlight
- [x] Current-time red line + "Now" jump button
- [x] Per-project color coding on event blocks (via the event's task →
      project)
- [x] Drag to create, drag to move, resize
- [x] Multi-day / all-day event banners
- [x] Nav (Calendar/Tasks/Focus/Gantt/Team) on every page, not just Tasks
- [x] "+ Focus block" quick-create — a pre-filled, locked "Focus time"
      event. Protected time doesn't need its own new mechanism: every
      event (locked or not) already blocks the auto-scheduler from
      placing a task into it (see `fetchBusyIntervals` in
      `src/lib/scheduler.ts`) — locking only stops that block itself
      from being auto-moved
- [x] Multi-select events (Shift/Cmd/Ctrl-click, ring highlight) with a
      floating "N selected" bar for bulk delete. Dragging the whole
      selected group together to bulk-*move* isn't built yet — tracked
      as GitHub issue #3 (retitled to reflect what's actually left).
- [x] Mini month-picker — calendar icon next to the date range opens a
      popover month grid to jump to any date.

## Scheduling / auto-plan
- [x] Auto-scheduler with energy-match + project-clustering, all now
      scoped per user
- [x] Locked events (booking, manual pins, focus blocks) never get moved
- [x] "Reschedule all" button — re-plans every unlocked *already-
      scheduled* task from scratch (unschedule + reschedule), not just
      stale slots and brand-new tasks like the existing "Schedule all"
- [x] Auto-reschedule on conflict — creating, editing, or dragging a
      one-off event now immediately re-plans any unlocked scheduled task
      it now overlaps, instead of waiting for the next Schedule-all/
      Reschedule-all pass. Recurring events are excluded from the
      instant check (a future occurrence's conflict is a sweep problem,
      still handled by the periodic pass) — see `rescheduleConflictsWith`
      in `src/lib/scheduler.ts`.
- [x] Deadline countdown / at-risk indicator — an unscheduled task shows
      an "Overdue" (red) or "Due soon" (amber, within 48h) badge on the
      Tasks page. A task that's already scheduled doesn't get one, since
      it already has a calendar slot.

## Tasks
- [x] **Task lifecycle status** — Created → Ongoing → (optionally
      Delayed) → Completed, replacing the old internal TODO/Scheduled/
      Done. Having a calendar slot is now tracked independently of status
      (via the linked Event, not a status value) — a task can be
      Created-and-scheduled, Ongoing-and-unscheduled, etc. "Ongoing" is
      either set manually ("Start" button) or shown automatically
      whenever now falls inside the task's scheduled window (a display
      computation, not a stored change) — see `TaskRow.tsx`. "Delayed"
      is always an explicit action ("Delay" button): pushes the due date
      to a date you pick and clears its calendar slot; delayed tasks are
      excluded from the auto-scheduler's sweep until manually un-delayed.
- [x] Recurring tasks, sticky last-used project, search/filter
- [x] Assign a task to a person or AI employee
- [x] Task creation is a modal (like Motion) — title, project, assignee,
      priority, duration, **start date**, due date, and repeat (presets
      + a Custom Mon/Wed/Fri-style weekday picker, reusing the same
      BYDAY logic Calendar events use)
- [x] **Editing an existing task** — click any task's title to reopen
      the same modal in edit mode, prefilled
- [x] Start date is a real scheduler input — the auto-scheduler won't
      place a task before its start date
- [x] Gantt / project timeline view (`/gantt`) — scheduled slot if
      placed, else start→due span (falls back to created→due span if no
      start date), grouped by project. Read-only for now (no drag-resize)
- [x] **AI syllabus import** (`/tasks/import`) — paste a syllabus,
      Claude extracts assignment/exam/reading due dates as a reviewable,
      editable list (title + date, with a plain-text reason whenever it
      couldn't resolve a date), you fix anything wrong, then bulk-create
      tasks. Needs `ANTHROPIC_API_KEY` in `.env` — see `.env.example`;
      the page shows a clear setup message if it's unset rather than
      erroring
- [x] **Local AI option** (Settings → AI / local model) — point the
      importer at a self-hosted OpenAI-compatible endpoint (e.g. Ollama
      on a desktop, reachable from other devices over Tailscale) instead
      of Claude, so it isn't subscription-dependent. Per-account URL +
      model name; falls back to Claude if left blank. Response parsing
      tolerates a local model wrapping its JSON in prose or a ```` ```
      ```` fence, since not all of them honor `response_format` reliably.
- [ ] **AI-assisted task creation with generated subtasks** — type
      something like "work on OmneHosting" and have the AI break it into
      real subtasks using whatever context it has access to. Bigger than
      syllabus import (needs a UI for reviewing/editing AI-proposed
      subtasks before they're created, similar to the syllabus review
      step, plus deciding what "context it has access to" concretely
      means — your other tasks? project notes? nothing yet beyond the
      prompt?). Flagged for a future pass, not started.
- [x] Sub-tasks — one level of checklist items under a parent task
      (`Task.parentId`, self-relation, cascades on delete). Expand a task
      on the Tasks page to see "N/M subtasks", check them off, add new
      ones inline, or delete one. Subtasks are excluded from the main
      task list, Focus, Gantt, and the auto-scheduler's sweep — they
      aren't independently schedulable calendar blocks, just a checklist.
- [x] Task priority visualized on the calendar block itself — a High or
      Urgent task's scheduled event shows a small flag (amber/red) in the
      corner of its block; Low/Medium don't, to avoid cluttering every
      block.
- [x] Tasks can now actually be deleted (`deleteTaskAction`) — previously
      the only way to remove a task row was the indirect project-delete
      cascade; there was no direct "delete this task" at all.

## Booking / scheduling links
- [x] Public booking page (`/book/<slug>`), now resolves the owning
      account from the slug so it works per-user, not just for one owner
- [ ] Multiple booking link types (different durations/slugs per user)
- [x] "Share availability" quick-copy message — Settings → Booking page
      → "Copy available times" copies a plain-text list of your next
      open slots to the clipboard, for pasting into an email/DM instead
      of sending the link.

## Feedback
- [x] In-app feedback button (bottom-right, every page except
      login/signup/booking) → saved to a `Feedback` table
- [x] Admin-only inbox at `/feedback-inbox` (first account only)

## Google Calendar sync
- [x] Deletions now sync both ways — deleting an event here removes it
      on Google (already worked), and deleting it directly on Google
      removes the local copy on the next sync (new: `showDeleted: true`
      + handling `status: "cancelled"` in `importFromGoogle`). Previously
      only the first direction was handled.
- [x] Verified live against the real connected account: the OAuth token
      refreshes correctly and a real import call succeeds end-to-end.

## Icons
- [x] All UI icons are inline SVG, not emoji (lock, robot/person for
      assignees, gear, sun/moon theme toggle, feedback chat bubble,
      close ×, repeat) — consistent rendering across platforms instead
      of relying on the OS emoji font. The one exception: assignee type
      inside a native `<select><option>` is plain text ("(AI)") since
      `<option>` can't render markup/SVG at all — a real platform limit,
      not an oversight.
- [x] Settings gear is a real cog (geometric teeth, not a circle with
      dashes around it).

## Meetings / integrations
- [ ] Video-call join banner ("Standup — starting in 1 min — Join call")
- [ ] External calendar overlay beyond Google (Outlook, Apple)

## Security deep-dive (2026-08-18)
Full pass over auth, authorization, and the public surfaces. Fixed:
- [x] Re-audited every server action for IDOR (acting on someone else's
      row by id) — none found; one real bug caught earlier in this same
      session (`unscheduleTask` could flip any user's task to TODO) was
      already fixed before this pass.
- [x] `/api/test/*` routes now require an explicit `E2E_TEST_ROUTES=1` in
      addition to non-production — previously only `NODE_ENV !==
      "production"` gated zero-auth endpoints that can create/delete
      data (arbitrary event creation, delete-by-title-prefix). One
      misconfigured deploy that never sets `NODE_ENV=production` was all
      that stood between the internet and those routes.
- [x] Google OAuth access/refresh tokens now encrypted at rest
      (AES-256-GCM, `TOKEN_ENCRYPTION_KEY` in `.env`) — were plaintext in
      the DB. Backward-compatible (unset key = plaintext, same as
      before) and self-healing for the access token on its next refresh;
      the refresh token needs one manual disconnect/reconnect after
      setting the key, since Google doesn't rotate it on its own.
- [x] Baseline security headers added (`next.config.ts`): CSP,
      X-Frame-Options: DENY, X-Content-Type-Options: nosniff,
      Referrer-Policy, Permissions-Policy. None of this existed before.
- [x] Signup rate-limited (5/hour/IP) — previously unlimited, so a
      script could mass-create accounts.
- [x] Password change now revokes every other session for that account
      (and re-issues one for the current device) — previously, changing
      your password did nothing to a session token that had already
      leaked; it would keep working forever.
- [x] Expired sessions are now deleted on the request that discovers
      them, instead of accumulating in the `Session` table forever.
- [x] Rate limiters (booking, login, signup) consolidated into one
      shared `src/lib/rateLimit.ts` instead of three copies of the same
      logic — same behavior, less to keep in sync.

Reviewed and judged acceptable as-is for this app's scale/trust model
(not fixed, with reasoning):
- In-memory rate limiters don't survive a restart or scale across
  processes — fine for a single-node self-host, revisit only if this
  ever runs multi-instance.
- No email verification on signup — acceptable for "you + friends you
  personally invite the link to," revisit before any open/public signup.
- Booking `bookingSlug` is globally unique across all accounts, not
  per-account — a minor UX/enumeration nit (two users can't pick the
  same slug), not a data-exposure issue.
- Feedback submissions have no per-user rate limit — requires being
  logged in already, low value target.

- [x] Session-management UI (Settings → Active sessions) — lists every
      device with a live session, marks "This device", lets you revoke
      one specific session or "Log out everywhere else" in one click.

Still open — the biggest gap before this goes on public DNS:
- [ ] Real "forgot password" (needs an email provider chosen first —
      not something to wire up speculatively without picking one).

## Explicitly out of scope for now
- Autonomous AI employees actually doing tasks (needs a real design
  conversation about what "do the task" means per task type — deferred
  on purpose, not forgotten)
- Enterprise/team billing, org-wide admin — this is "you + friends you
  trust," not a multi-tenant SaaS

---
## Before the public DNS / sharing with friends
Login rate limiting and change-password now exist, but a full security
pass on the account system hasn't happened yet — same category of gap
the overnight session found and fixed for the booking page (rate limits,
slot re-validation) deserves a repeat pass here before this is actually
public: a real "forgot password" flow (needs picking an email provider),
session revocation UX (e.g. "log out everywhere"), and a fresh
adversarial review of every server action's ownership checks. Flag this
explicitly before sharing the link, not after.

**Proposed next 3:** (1) pick an email provider and build real
forgot-password — the last real gap before this is public; (2)
AI-assisted task creation with generated subtasks — needs a design pass
on scope/context first; (3) mini month-picker + click-drag multi-select/
bulk-move on the calendar.
