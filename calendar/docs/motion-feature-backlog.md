# Motion replica — feature backlog

## Task-producing calendar subscriptions (2026-08-23, #57)
Prompted directly by the user: they use Blackboard and want new/changed
assignments to become a real, auto-scheduled Task, not just show up on the
calendar — assignments trickle in through a semester rather than posting
all at once, so the existing AI syllabus-paste import only covers the
majority, not the live tail. Most school LMSes (Blackboard, Canvas, etc.)
expose a personal ICS feed of assignment due dates — this app already had
a generic "subscribe to any ICS URL" feature (#32, `CalendarSubscription`)
but it only ever wrote read-only overlay `Event` rows (locked, like Apple
sync), never something the auto-scheduler could act on.

- [x] **`CalendarSubscription.importAsTasks`** (default false) — a
      per-subscription toggle in Settings → Calendars. Off = unchanged
      overlay-Event behavior (e.g. a public holidays calendar). On = each
      feed item becomes a real `Task` instead.
- [x] **Dedup/re-sync model** — `Task.sourceSubscriptionId` +
      `Task.sourceUid` (the feed item's stable ICS UID), unique together,
      mirrors how `Event.subscriptionEventUid` already dedups the
      overlay-Event path. **Only `dueAt` re-syncs after first import** —
      title/notes are a one-time seed. This is deliberate: a user who
      retitles or edits the task shouldn't have those edits silently
      clobbered by the next sync just because the upstream feed still has
      the original text. The one thing genuinely worth staying live is
      the deadline itself.
- [x] **Removed-from-feed items are left alone** — no delete pass in task
      mode (unlike overlay mode, which prunes anything no longer in the
      feed). An assignment the user's already started working on
      shouldn't vanish because Blackboard changed something upstream.
- [x] New task gets `durationMin: 60` (a generic default — imported items
      never specify a real work-time estimate), `notes` = the feed item's
      own description/link (already parsed by `parseIcsEvents`, no parser
      changes needed) plus a "Imported from {subscription name}" line for
      traceability even with no link, and is immediately run through
      `scheduleTask` so it lands on the calendar right away rather than
      waiting for the user to notice it in the task list and hit
      Schedule — matches what was actually asked for ("auto schedule time
      for me to get it done before").
- Deliberately not built: a dedicated test file for the sync logic itself
  — it's DB/network-orchestration code with no existing test pattern in
  this repo to extend (the repo's `*.test.ts` convention covers pure
  functions like `scheduler.ts`/`recurrence.ts`, not `actions.ts`-shaped
  code); relying on `tsc`+`build` plus the same manual-verification bar
  every other `actions.ts` addition in this app's history has used.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean.

## Security + accessibility audit (2026-08-22)
Prompted by a user-shared "20 things to check before launching" checklist
plus an explicit ask for OWASP Top 10 and accessibility coverage. Builds on
the 2026-08-18 "Security deep-dive" and 2026-08-19 "Server-action ownership
re-audit" above — re-verified those findings still hold and specifically
re-checked every server action added *since* (attachments/activity log,
timezone, multi-account Google, booking min-notice/max-per-day, recurrence
splitting, project templates) for the same IDOR/tampering bug class.
`src/app/actions.ts`/`scheduleChat.ts`/`aiClient.ts`/the new chat UI were
mid-edit by a concurrent session (#55) — read-only for this pass, findings
there are flagged, not fixed.

**The 20-item checklist:**
- ✅ **API keys hidden** — `.gitignore` covers `.env*`; `.env` never
  committed; `.env.example` has empty placeholder values only.
- ✅ **No secrets in git history** — scanned full history for common
  key/token patterns (`AIza...`, `sk-...`, PEM headers). Nothing found.
- ➖ **"Public DB key"** — N/A, SQLite+Prisma has no anon-key concept;
  `DATABASE_URL` is a local file path, never sent to the client.
- ✅ **Row-level security equivalent** — spot-checked every action added
  since the 2026-08-19 audit (`getTaskActivityAction`, `addTaskCommentAction`,
  `addTaskAttachmentAction`, `deleteTaskAttachmentAction`,
  `disconnectGoogleAction`, `setDefaultGoogleAccountAction`,
  `renameGoogleAccountAction`, `syncUserTimezoneAction`,
  `setUserTimezoneAction`, booking min-notice/max-per-day form parsing) —
  all correctly scope by `userId`/ownership. `googleAccountIdFromFormData`
  (the per-event "Sync to" override from #52) also verifies ownership
  before trusting a client-supplied account id — same `verifyOwnedId`
  discipline as the rest of the file.
- ⚠️ **One real gap, flagged not fixed (actions.ts mid-edit by #55)**:
  `addTaskAttachmentAction` trusts a client-supplied `storedPath` verbatim
  without verifying it's under the caller's own `${user.id}/` upload
  directory. A server action can be invoked directly with arbitrary args,
  not just through the upload UI — low severity (the on-disk name is an
  unguessable random UUID, and Next's static file serving doesn't traverse
  `..` outside `public/`), but should still check
  `storedPath.startsWith(\`${user.id}/\`)` before writing the row, same
  defense-in-depth already applied to every other client-supplied id in
  this file. **Follow-up needed** once #55's edits land.
- ✅ **Sensitive data encrypted at rest** — `TOKEN_ENCRYPTION_KEY`
  (AES-256-GCM) still covers every `GoogleAccount` row's tokens; #52's
  move to multiple accounts per user didn't change the encryption path,
  just added more rows using the same one.
- ✅ **Server-side auth on every action** — swept all 92 exported
  functions across `actions.ts`; only 3 lack `requireUser()`
  (`respondToInviteAction`, `getInviteAction`, `createBookingAction`),
  all three genuinely public by design (token/slug-resolved, same as the
  2026-08-19 audit already noted for booking).
- ✅ **Record access locked to owner** — same finding as row-level
  security above.
- ✅ **Field tampering blocked** — booking link min-notice/max-per-day
  values are clamped server-side (0–10,080 min, 1–100/day) regardless of
  what the client sends; no action spreads raw FormData into a Prisma
  `data:` object without an explicit field list.
- ✅ **Session cookies secure** — `httpOnly: true`, `secure` in
  production, `sameSite: "lax"` (`src/lib/auth.ts`).
- ✅ **Passwords hashed** — `scrypt` (Node stdlib, no dependency) with a
  random salt per password and `timingSafeEqual` comparison — not a weak
  hash, not plaintext.
- ✅ **Login rate-limited** — 8/15min/IP, shared `src/lib/rateLimit.ts`,
  still wired correctly.
- ➖ **Bot protection (CAPTCHA)** — genuinely absent, same accepted
  tradeoff the 2026-08-18 audit already reasoned through for this app's
  scale (rate limiting exists instead); still holds.
- ✅ **Parameterized queries** — zero `$queryRaw`/`$executeRaw` anywhere;
  100% through Prisma's query builder.
- ✅ **Input validation** — spot-checked; numeric fields clamped, enum
  fields validated against an allow-list, empty/malformed values dropped
  rather than trusted (`isValidTimeZone`, `parseBookingLinkForm`, etc.).
- ✅ **User content escaped (XSS)** — `src/lib/markdown.ts` strips raw
  HTML entirely (`renderer.html = () => ""`), allowlists link/image URL
  schemes, and escapes attribute values — already hardened. Its own
  "self-XSS only, notes are private to their author" reasoning was
  re-verified still true: confirmed `SharedEvent` (calendar sharing) never
  includes `notes`, and the public RSVP page never renders event notes to
  a guest — notes still never cross to a second real account.
- ✅ **File uploads restricted** — both upload routes (`/api/uploads`,
  `/api/uploads/attachments`) use a MIME allowlist (SVG deliberately
  excluded from both — active XSS vector), a size cap, and a
  server-generated random filename, never the client's own filename, for
  the on-disk path.
- 🔧 **Security headers** — added `Strict-Transport-Security` (was
  missing entirely; inert over plain HTTP, so harmless without a
  reverse-proxy TLS terminator and effective once one exists). Everything
  else (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy)
  already covered nothing new needed adjusting for any feature shipped
  since.
- 🔧 **HTTPS enforced** — this app never terminates TLS itself; documented
  that assumption directly in `next.config.ts` (a self-host needs a
  reverse proxy — nginx/Caddy/etc. — in front of it) rather than leaving
  it silently assumed.
- ⚠️ **Dependencies scanned** — `npm audit`: 3 *high* findings, all the
  same root cause (`deepmerge-ts` stack-exhaustion advisory,
  GHSA-ggr8-5vv4-36mx) pulled in transitively by `@prisma/config` →
  `prisma` (the CLI/migration tool), **not** `@prisma/client` (the actual
  runtime query engine this app's requests go through). `npm audit fix
  --force`'s suggested fix is actually a *downgrade* to an older prisma
  — not a real fix, just npm's resolver finding an older tree without the
  vulnerable transitive dep. Reviewed and accepted: exploiting this needs
  attacker-controlled input reaching the Prisma CLI's own config-merging
  step, which never happens in this app's request path (only at `migrate`/
  `generate` time, over inputs this repo itself controls). Revisit when
  a genuinely newer `prisma` release drops the vulnerable transitive dep.

**OWASP Top 10 (2021)**: Broken Access Control ✅ (per row-level-security
findings above, minus the one flagged attachment gap), Cryptographic
Failures ✅ (scrypt + AES-256-GCM), Injection ✅ (Prisma-only, no raw SQL),
Insecure Design ✅ (confirm-before-execute being designed into #55 rather
than bolted on after is exactly this working as intended), Security
Misconfiguration ✅ (headers/CSP, now +HSTS), Vulnerable/Outdated Components
⚠️ (see npm audit above — accepted, not exploitable in this app's own
request path), Identification/Authentication Failures ✅ (rate limiting,
hashing, session revocation), Software/Data Integrity Failures ➖ (no
CI/CD artifact signing or unsanitized deserialization surface exists to
fail), Security Logging/Monitoring Failures ➖ (accepted — no centralized
log aggregation for a single-user/small-group self-host; revisit only if
this ever runs multi-tenant), **SSRF** ✅ — already excellent:
`calendarSubscriptions.ts`'s `assertPublicUrl` resolves the hostname to an
actual IP and rejects private/loopback/link-local ranges (not just a
hostname-string check), disables redirects, and caps response size —
exactly the right shape for a feature whose entire point is "fetch a
URL I don't control."

**Accessibility**: dialog roles/`aria-modal` consistent across all 7
modal-style components (nothing found missing it). Icon-only interactive
elements checked — the one hit (`team/page.tsx`'s person/robot icon) is
decorative next to visible text, not an unlabeled control. RSVP/priority
status already pairs color with text/an icon+tooltip, never color alone.
Keyboard alternative to drag-to-move an event already exists (click →
EventModal → edit Start/End directly). 🔧 One real gap fixed: the
calendar search input (`CalendarSearch.tsx`) stripped the focus outline
(`outline-none`) with no visible replacement — a keyboard user tabbing to
it got zero focus indicator. Added `focus-within:ring-2` to its container.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean. No schema
changes. Nothing touched in `actions.ts`/`scheduleChat.ts`/`aiClient.ts`/
the new chat UI (owned by the concurrent #55 session) — the one finding
there (`addTaskAttachmentAction`'s `storedPath` trust) is flagged above
for follow-up once that lands.

## AI chat can now take action (2026-08-22, #55)
`src/lib/scheduleChat.ts` was explicitly read-only — its system prompt
said "you cannot create, edit, or delete anything." Justin decided the
scope (full CRUD including delete) and the confirm UX (inline card, not
auto-execute) up front; this session built it.

**Model**: no new tool-use SDK plumbing — `callAiForJson` (Claude
structured-output / local-model JSON mode) already turns one chat turn
into one validated JSON object, so a chat reply is now
`{ reply: string, actions: ChatAction[] }` instead of just `{ reply }`.
`ChatAction` (new `src/lib/chatActions.ts` — client-safe, no `prisma`
import, since `ChatClient.tsx` needs `describeChatAction` too) is one
flat object with a `kind` enum (`createTask`/`updateTask`/`deleteTask`/
`scheduleTask`/`createEvent`/`moveEvent`/`updateEvent`/`deleteEvent`)
rather than a discriminated union — safer across both the Claude
structured-output JSON Schema conversion and the local-model path.

- [x] **Confirm-before-execute** — a proposed action never runs on its
      own. `ChatClient.tsx` renders each one as a card (built from
      `describeChatAction`, the exact same pure function the executing
      code's inputs came from — display and execution can't drift apart
      since neither re-derives anything from the model's prose). Confirm
      calls the new `executeChatActionAction` in `actions.ts`; Cancel
      just flips local state, no round-trip. Multiple proposed actions in
      one reply are independently confirmable/cancelable.
- [x] **Real ids in context, not name-matching at execute time** —
      `buildScheduleContext` now includes each task/event's real id
      (`masterId` for a recurring occurrence, not the synthetic
      `masterId::ISO` composite) inline as `[id]`. The model must copy an
      id it already saw, never invent or re-find one by title later —
      ambiguous requests ("reschedule my dentist thing" with 3 matching
      tasks) are supposed to become a clarifying question in `reply` with
      zero proposed actions, not a guess.
- [x] **Reuses existing trusted actions, no new mutation logic** —
      `executeChatActionAction` calls `createTask`/`updateTask`/
      `deleteTaskAction`/`scheduleTaskAction`/`createEvent`/`moveEvent`/
      `updateEvent`/`deleteEvent` exactly as the real UI does, so every
      ownership check those already have (this codebase had a real IDOR
      bug class fixed exactly here once) covers chat-originated mutations
      for free. `updateTask`/`updateEvent` replace every FormData field,
      so a partial chat edit (e.g. "bump the priority") first fetches the
      row's current full state and merges the one changed field in,
      rather than blanking out everything else.
- [x] Self-check: `src/lib/chatActions.test.ts` (schema validation +
      `describeChatAction` output), chained into `npm test`.

No schema change — a pending action lives in the chat UI's own React
state until confirmed, nothing persisted.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean.

## Google Calendar parity audit, round 4 (2026-08-22)
Fresh sweep after the queue got thin over three prior rounds. Checked
keyboard-shortcut completeness against Google's published list (still
covers the common ones, no drift), ISO week numbers, "insert from Drive"
(genuinely out of scope — no Drive integration exists or is planned),
per-calendar default event color (this app's per-project color already
covers the practical want), and notification snooze/dismiss-all (already
covered — the notification watcher's existing dismiss already applies
per-notification, and volume is low enough for a personal app that a
bulk action isn't worth the UI it'd need).

Two real, small gaps shipped:
- [x] **Event location field** (#56) — Google Calendar has always had a
      separate plain-text physical/informal location ("Room 4B", "123
      Main St") *in addition to* a video-call link. This app only had
      `meetingUrl`. Added `Event.location` (migration
      `20260822190035_add_event_location`), a field in `EventModal`,
      full round-trip through `createEvent`/`updateEvent`/
      `updateEventOccurrence`/`updateEventFollowing`, ICS export/import
      (`LOCATION:`, standard iCal property), and both Google
      (`item.location`) and Apple (`event.location`, `ical.js` exposes
      it the same way `.description` already was) sync — same treatment
      `notes` got in an earlier round, so it doesn't quietly regress the
      next time someone touches sync code. Skipped: showing location on
      the public RSVP page — the guest-facing page currently only shows
      title/time/meeting link; a reasonable follow-up but not required
      to close the "does this field exist at all" gap.
- [x] **"Delete this and following" recurring events** — the parallel
      delete-scope option to #54's edit-scope, explicitly deferred out
      of that pass. Trivial now that `Event.recurrenceEndsBefore`
      exists: `deleteEventFollowing()` just sets the cutoff on the
      master (nothing to carry forward, unlike the edit-scope version
      which creates a new master). Splitting at the series' own anchor
      delegates to plain `deleteEvent`. `EventModal`'s three-way scope
      toggle (already built for #54) now drives delete too, with its own
      explainer line.

Deferred, not filed as new issues (both still on file from prior
rounds): #55 (AI chat taking action, needs a confirm-before-execute UX
design pass) and general "gaps are genuinely scarce now" — this was a
smaller-finds round by design, not a full re-audit.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean. Schema
touched (`Event.location`) — needs `npx prisma generate` + a dev-server
restart.

## Motion core + advanced feature audit (2026-08-22)
Re-centered on Motion itself after several Google-Calendar-focused
sessions — researched Motion's actual current (2026) feature set via
its own marketing/recent reviews (G2, Capterra-adjacent sites,
hirekai.ai, efficient.app), cross-checked every item against this app.

**Confirmed already covered, several exceeding Motion**: auto-scheduling
with dynamic rescheduling, Reschedule-all, focus-time protection, task
dependencies, multiple views (list/board/table/calendar/Gantt),
AI-generated projects from a prompt (`/tasks/generate-project`), booking
links (now with min-notice + max-per-day, ahead of Motion's own
Appointment Schedules), time tracking (`Task.trackedMinutes`, #30),
daily overcommitment warning (#27) and shutdown ritual (#28), an AI
"docs" equivalent (`docDraft.ts` — task brief generation) and an AI chat
over your own schedule/tasks (`scheduleChat.ts`, #11).

**Already correctly tracked/deferred, not re-opened**: AI meeting
notetaker (#16, needs real audio/transcription), broader native
integrations (#20, OAuth-blocked), Outlook two-way sync (same OAuth
blocker), "AI Employees" doing autonomous *external* work (Slack
actions, CRM updates, drafting outreach emails) — explicitly out of
scope per this doc's own "Explicitly out of scope" section; team
capacity/permissions/enterprise reporting — same section, not a personal-
app feature.

Two real findings:
- [x] **Project templates** (Motion: "Standardized Project Workflow
      Template") — this app could *generate* a project from a prompt but
      had no way to *save and reuse* a project's task structure. New
      `ProjectTemplate`/`ProjectTemplateTask` models (title/notes only —
      no dates/assignee/color, those are per-instantiation, not part of
      the reusable shape). `saveProjectAsTemplateAction` snapshots an
      existing project's top-level tasks (subtasks excluded, same scope
      subtasks already have everywhere else); `createProjectFromTemplateAction`
      instantiates a new Project + Tasks from one, reusing the exact
      Project-plus-Tasks shape `createProjectFromPlanAction` (AI-generated
      projects) already established. UI: "Save as template" per project
      and a "Project templates" manager, both in Tasks page's existing
      `<details>`-based project management section — no new page.
- **#55 filed, not built**: this app's AI chat (`scheduleChat.ts`) is
  explicitly read-only by design ("you cannot create, edit, or delete
  anything" is in its own system prompt) — Motion's chat can actually
  take action (create/reschedule via conversation). Real, distinct gap
  from the out-of-scope "AI Employees" (this would be tool-calls into
  this app's *own*, already-trusted server actions, not external
  actions) — but needs a real confirm-before-execute UX design pass
  before building, so a wrong LLM interpretation of a chat message can't
  silently mutate data. Flagged for its own scoping session.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean. Schema
touched (`ProjectTemplate`/`ProjectTemplateTask`, migration
`20260822185541_add_project_templates`) — needs `npx prisma generate` +
a dev-server restart.

## "This and following events" recurring edit scope (2026-08-22, #54)
The item round 3 filed and deliberately deferred — Google's third
recurring-edit option, beyond this app's existing "this event" (#40) /
"all events" pair.

Model: splits the series at the edited occurrence's original start.
- [x] **`Event.recurrenceEndsBefore`** (new nullable `DateTime` column) —
      an exclusive cutoff checked in `expandEventOccurrences`
      (`recurrence.ts`): the old master stops generating occurrences
      on/after this instant. Deliberately *not* an RRULE `UNTIL` clause —
      `UNTIL` is a literal UTC instant per RFC 5545, but this app's own
      recurrence math (`buildLocalRRule`) treats every rule field as
      local-wall-clock-relabeled-as-UTC for DST correctness; round-
      tripping a real UTC instant through that scheme on a non-UTC server
      would silently shift it by the zone offset. A plain column sidesteps
      that whole class of bug instead of fighting it.
- [x] **`updateEventFollowing(masterId, originalStartIso, formData)`**
      (`actions.ts`) — sets `recurrenceEndsBefore` on the old master,
      creates a new master at the (possibly edited) occurrence's start
      carrying the form's edits and the *same* recurrence pattern (or a
      new one, if the user changed Repeat — the split point is exactly
      where "start a different pattern from here on" naturally belongs).
      Any pre-existing single-occurrence exceptions (#40) dated on/after
      the split point get reassigned to the new master (`recurrenceExceptionOfId`)
      and re-excluded on it — otherwise the new master would regenerate a
      raw occurrence at that slot, duplicating the still-existing
      exception row.
- [x] **Degenerate case**: splitting at the series' own anchor date is
      just "all events" with extra steps (nothing before it exists to
      preserve) — delegates straight to the existing `updateEvent` rather
      than creating a redundant, zero-occurrence old master.
- [x] **`EventModal.tsx`**: the "This event"/"All events" toggle (shown
      only when editing a raw recurring occurrence) is now three-way,
      with a short explainer under Repeat when "This and following" is
      selected.
- [x] New test coverage in `recurrence.test.ts` for the cutoff filter,
      including combined with a pre-existing `excludeDates` entry.

Deliberately **not** built this pass: **delete-scope** ("delete this and
following," Google's parallel option). The ask was specifically the edit-
scope gap; delete still only supports "this occurrence" or "whole series"
(existing, correctly-labeled behavior in the UI — not silently wrong,
just narrower). Worth a quick follow-up (reuses the same
`recurrenceEndsBefore` field — trivial once someone wants it) but not
bundled in here to keep this change reviewable on its own.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean. Schema
touched — needs `npx prisma generate` + a dev-server restart.

## Google Calendar parity audit, round 3 (2026-08-22, #53 follow-ups)
Fresh sweep after round 2 — checked recurring "this and following" edit
scope, event templates/duplicate-with-modifications, calendar-wide default
duration/color settings, Year view, side-by-side calendar comparison vs.
this app's overlay approach, print/PDF month-view coverage, and a
grid-based "Find a time" alternative to #45's earliest-slot auto-pick.
Judged not worth building now: Year view and side-by-side comparison are
real Google features this app doesn't have, but neither came up as an
actual want and both are meaningfully large UI additions for uncertain
value — flag for a future session if there's real demand, not filed as
issues speculatively. A grid-based "Find a time" view is a genuine
alternative UX to the current auto-pick, but #45's earliest-slot flow
already fully solves the stated problem ("find a time that works") —
adding a second, manual-eyeball UI is a nice-to-have, not a gap.

Picked up both items round 2 had deferred as smaller-but-real:
- [x] **Max bookings per day** — `BookingLink.maxPerDay` (nullable, default
      unlimited), enforced in both `getAvailableBookingSlots` (slots for
      an already-full day stop being offered) and `createBooking`'s
      re-validation. Needed a small schema addition to actually count
      "bookings for *this link*, today" rather than "every event the
      owner has today": `Event.bookingLinkId` (nullable, `SetNull` on
      link delete so booking history survives a link being removed).
      Settings field in `BookingLinksManager.tsx`, same "blank = no
      limit" pattern as `excludeDays`.
- [x] **Picker for a non-primary calendar within a connected Google
      account** — `GoogleAccount.calendarId` already existed and defaulted
      to `"primary"`, just had no UI. Added `listGoogleCalendars` (new
      `calendarList.list` call in `google-auth.ts`, same OAuth scope
      already granted) and a lazy-loaded "Change calendar" picker per
      account in `GoogleAccountsManager.tsx` — only calls the Google API
      when actually opened, not on every Settings page load.

Filed but deliberately **not** built this round — a real gap, but a
recurrence-engine change risky to rush through a single unsupervised pass:
- **#54 "This and following events" recurring edit scope** — Google's
  third option beyond this app's existing "this event"/"all events"
  (#40). Needs careful design on how existing exceptions/excludeDates
  migrate across the series split; see the issue for the specific
  failure mode to avoid.

`npx tsc --noEmit`, `npm test`, `npm run build` all pass clean.

## Google Calendar parity audit, round 2 (2026-08-22, #53)
Fresh sweep after the overnight session + this morning's #46/#31/#52,
looking at areas not explicitly checked before: Google Tasks parity
(already exceeded — this app's tasks have real scheduled times, subtasks,
labels, dependencies, none of which Google Tasks has), Appointment
Schedules' advanced options, notification channels beyond in-app,
"smart"/structured event parsing from email (genuinely out of scope — no
mailbox access, not this app's model), keyboard shortcut completeness,
event visibility (Public/org-private — doesn't map onto this app's
single-tenant-per-account model), offline/PWA support, and syncing a
*non-primary* calendar within one already-connected Google account (a
smaller, separate thing from #52's multi-*account* support — noted as a
real but lower-value follow-up, not built this round: `GoogleAccount.
calendarId` already supports it structurally, just has no picker UI yet).

One real, well-scoped gap found and shipped:
- [x] **Booking links had no minimum-notice period** (#53) — Google's
      Appointment Schedules let you require lead time before a booking
      (e.g. "at least 1 hour"); this app's `getAvailableBookingSlots`/
      `createBooking` (`src/lib/booking.ts`) started the search at `now`
      with no offset, so a visitor could see and book a slot starting in
      the next few minutes. Added `BookingLink.minNoticeMin` (default 60,
      same "an hour's notice" default most scheduling tools ship with),
      threaded through slot generation (search cursor starts at
      `now + minNoticeMin`) and the create-time re-validation (rejects a
      submission inside the notice window even if the client's slot list
      was momentarily stale). UI: a "Minimum notice" minutes field in
      `BookingLinksManager.tsx`, same pattern as the existing
      `excludeDays` field.

Deferred, not filed as its own issue (lower value, smaller): a "max
bookings per day" cap on a booking link — genuinely a Google Appointment
Schedules feature this app lacks, but a narrower want than minimum notice
(preventing an overbooked day is more a "for high-volume booking pages"
problem than a personal-use one); and picking a non-primary calendar
within one connected Google account (see above).

`npx tsc --noEmit`, `npm test`, and `npm run build` all pass clean.

## Multiple connected Google accounts — personal + work (2026-08-22, #52)
Justin explicitly asked for "connect multiple calendars from Google...
someone's personal and someone's work" as part of a broader group-
scheduling + Google-parity push. Also verified (no code change needed):
**group scheduling already doesn't leak schedules** — `/meet` only offers
people who've shared their calendar with you at *any* permission level
(including `BUSY_ONLY`), and `findGroupSlot`/`fetchBusyIntervals` only
ever compute start/end intervals server-side — no title/notes/location
ever reaches the client, even transiently. Nothing to build there.

Root cause confirmed by reading the code: `GoogleAccount.userId` was
`@unique` — exactly one Google account per app-user — and the OAuth
callback (`api/google/callback/route.ts`) `deleteMany`'d any existing
account before creating a new one, so connecting a second account
silently destroyed the first. `google-auth.ts`/`google-sync.ts` assumed
exactly one account per user throughout.

Product decision (Justin's call): one connected account is the
"default" for brand-new locally-created events; a per-event "Sync to"
override picks a different one. All connected accounts sync two-way
(not read-only like Apple).

- [x] **Schema**: dropped `@unique` on `GoogleAccount.userId` (kept the
      FK, now one-to-many); added `label` (renameable display name,
      defaults to the account's own email) and `isDefault` (exactly one
      true per user, enforced in application code, not a DB constraint
      SQLite can't express cleanly); added `@@unique([userId, email])`
      so reconnecting the same Google account updates its tokens in
      place instead of creating a duplicate row. `Event.googleAccountId`
      (nullable FK, `onDelete: SetNull`) ties an event to a specific
      account; `googleEventId`'s uniqueness moved from global to
      `@@unique([googleAccountId, googleEventId])`. Migration backfills
      every pre-existing Google-synced event onto its (single, by the
      old constraint) existing account.
- [x] **`google-auth.ts`/`google-sync.ts` rewritten per-account**:
      `getAuthorizedClient` takes a `googleAccountId` now, not a
      `userId`; new `listGoogleAccounts(userId)`. `importFromGoogle`/
      `exportToGoogle`/`deleteFromGoogle` all operate on one account;
      `syncGoogleCalendar(userId)` loops every connected account and
      aggregates the results. An untagged (new) local event exports to
      whichever account `isDefault` — and gets tagged with that
      account's id the moment it's first pushed, so a later default
      change doesn't reroute something already synced somewhere.
- [x] **OAuth callback** no longer replaces — `upsert`s on
      `(userId, email)`, first-ever connection becomes the default
      automatically.
- [x] **Settings** (`GoogleAccountsManager.tsx`): lists every connected
      account (renameable label, "Default" badge, "Set as default",
      "Disconnect" scoped to just that one account — promotes another to
      default if the disconnected one was it), "Connect another Google
      account" button.
- [x] **`EventModal.tsx`**: a "Sync to" select, shown only with 2+
      connected accounts (nothing to choose with 0 or 1) — picks a
      specific account for that one event, or "Default account" (no
      pin, follows whichever's currently default).

Deliberately not built: a true "never sync this event to Google at all"
exclusion, independent of which account is default — the ask was
personal-vs-work account routing, not per-event opt-out; add if that
turns out to be a real, separate want.

`npx tsc --noEmit`, `npm test`, and `npm run build` all pass clean.

## Task attachments + activity log (2026-08-21, #31)
The other "medium-large" item left for a real scoping pass, done right
after #46. #31's original issue body was stale — 4 of its 5 items
(auto-scheduled indicator, hard deadline, chunking, rich-text notes) had
already shipped in earlier sessions per this doc; the only real remaining
scope was file attachments + an activity/comment log.

Scope note, worth keeping on file: this is a **single-user** log, not a
multi-party thread. `Task.assigneeId` points at an `Assignee` row — a label
under the owning account, not a second real `User` — and real accounts
only ever share *calendars* (`CalendarShare`), never tasks. So this is a
running notes-to-self on your own task, with no visibility/permission model
to build.

- [x] **`TaskAttachment`/`TaskActivity` models** — attachments cascade-
      delete with their `Task`; activity is either an auto-logged field
      change (`kind: "field"`) or a freeform comment (`kind: "comment"`),
      both just a `detail` string (comments store the text verbatim,
      field changes get a server-generated line so a client can't spoof
      what "changed").
- [x] **Upload route** `/api/uploads/attachments` — same convention as the
      existing note-image uploader (`/api/uploads`: random on-disk name
      under `public/uploads/<userId>/`, original filename never trusted
      for the path), widened for real attachments: 20MB cap (vs. the
      image uploader's 5MB) and a MIME allowlist covering PDF, plain
      text/CSV, Word/Excel/PowerPoint (both legacy and OOXML), zip, and
      the same image types as before. SVG excluded for the same reason
      as the existing uploader (embeddable `<script>`).
- [x] **`updateTask` now diffs and auto-logs** priority/due-date/assignee
      changes (the fields it actually writes — `status` changes go
      through separate actions like the Start/Delay buttons, not
      `updateTask`, and aren't wired into the log this round — a small,
      clearly-scoped follow-up if wanted later, not forgotten).
- [x] **TaskModal**: new Attachments section (upload input, list with
      download link + delete) and Activity section (merged timeline of
      field changes + comments, a comment box at the bottom) — same UI
      shape as `EventModal`'s Guests section (list + a small inline
      add-form, no nested `<form>`).
- [x] Ownership checks on every new action (`addTaskAttachmentAction`,
      `deleteTaskAttachmentAction`, `addTaskCommentAction`,
      `getTaskActivityAction`) — each resolves the task (or the
      attachment's task) scoped to `userId` before doing anything, same
      discipline as the 2026-08-19 fifth-pass IDOR audit that fixed this
      exact bug class elsewhere in this file.

`npx tsc --noEmit`, `npm test`, and `npm run build` all pass clean.

## Multi-timezone support (2026-08-21, #46)
The "medium-large" architecture item the overnight session deliberately
left for a real scoping pass — done as its own follow-up session, scoped
per Justin's own direction: auto-detect + editable in Settings, and the
*full* fix (scheduler, booking page, and Google-sync export all honor each
account's own zone), not just a display-layer patch.

Root cause confirmed by reading the code first: `scheduler.ts` built every
work-hours window with `setHours()`/`getHours()` on a plain `Date`, which
resolves in the *server process's* own timezone — wrong the moment a real
account's browser timezone differs from wherever this app happens to be
hosted. `google-sync.ts`'s `LOCAL_TIMEZONE` had the same problem for
recurring-event export.

- [x] **`User.timezone`** — nullable IANA zone string. Null = server's own
      zone (zero behavior change for an account that hasn't set one yet).
- [x] **`src/lib/timezone.ts`** — native `Intl`-only zone math (no new
      dependency): `getTimeZoneOffsetMinutes`, `getZonedWeekday`,
      `getZonedDateParts`, `zonedWallTimeToUtc`. Self-check in
      `timezone.test.ts` (now chained into `npm test`). One documented
      known gap: the wall-clock hour inside a spring-forward/fall-back
      DST transition itself isn't specially disambiguated — flagged with
      a `ponytail:`-style comment rather than built now.
- [x] **`scheduler.ts` rewritten to take a `timeZone` on every window
      builder** (`workWindowFor`, `defaultWindowFn`, `windowFnFor` and
      its `windowFnForTimeSlot`/`windowFnForWorkingHours` wrappers,
      `excludeDaysWindowFn`, `findEarliestSlot`'s day-boundary
      `skipToNextDay`, `dateKey`/`isEnergyMatch`/`scoreSlot` for
      project-clustering and energy-window scoring) — `scheduleTask` now
      fetches the task owner's own `User.timezone` and threads it
      through everywhere. Defaults preserve the old server-zone behavior
      for callers that don't pass one yet (habits.ts, existing tests).
- [x] **Group scheduling (#45) now genuinely per-participant** — new
      `intersectWindowFns` combines every participant's own working-hours
      *and* timezone into one shared window (a slot only counts if it's
      inside *everyone's* own local work hours, not just the requester's
      9-6). `findGroupSlot` fetches each participant's `AppSettings` +
      `timezone` and intersects. This is the concrete case #46's own
      scoping note flagged as "a real prerequisite for group scheduling
      being correct across timezones."
- [x] **Booking page / `booking.ts`** — availability generation and the
      re-validation on submit both use the booking-link owner's own zone;
      day-grouping keys are now the owner's own calendar day, not the
      server's.
- [x] **`google-sync.ts` `exportToGoogle`** uses the exporting account's
      own zone for the Google Calendar API's `timeZone` field, falling
      back to the server's zone only if unset.
- [x] **Auto-detect + Settings**: `TimezoneSync.tsx` (mounted in
      `layout.tsx`, same hidden-route pattern as `SyncWatcher`) calls a
      new `syncUserTimezoneAction` once per load with the browser's own
      `Intl` zone — never overwrites an already-set value. Settings →
      Scheduling has a "Your timezone" field (`setUserTimezoneAction`,
      reusing the existing `Intl.supportedValuesOf("timeZone")` datalist
      the World-clock field already had) for a manual override.

Deliberately not touched: `habits.ts` still schedules against the
hardcoded 9am-6pm default window (now at least in the *right* timezone),
not the user's real working-hours settings — pre-existing gap, unrelated
to timezone correctness, not in scope here.

`npx tsc --noEmit`, `npm test`, and `npm run build` all pass clean.

## Overnight Google Calendar parity session — wrap-up (2026-08-21)
Five self-paced iterations (each a background research-then-ship pass, see
the individual iteration entries directly below), triggered by an explicit
ask to treat Google Calendar feature parity as the priority bar — this app
is a stated Google Calendar replacement/overlay, not just a Motion clone.

**Shipped**: per-event reminders w/ presets (#47), event description/notes
field in EventModal (#48), tentative "Maybe" RSVP status (#49), show/hide
toggle for shared calendars (#50), notes syncing to/from Google + Apple
(#51). All five: `npx tsc --noEmit` + `npm test` clean before commit,
committed locally only (never pushed), each backed by its own closed
GitHub issue.

**Checked and judged NOT gaps** (so a future session doesn't re-propose
them): 8-color event palette vs. Google's 11 (deliberate choice), single-
event `.ics` download (already exists, `/api/ics/export`), duplicate-event
quick action, drag-across-days all-day creation in month view, guest
permission tiers beyond RSVP, declining an invite with a note, search
query operators beyond plain text, color inheriting from the wrong source.

**Deliberately not attempted this session** — real, already-filed gaps,
but each is a bigger architectural lift than a single background
iteration should take unsupervised: **#46 multi-timezone support** (touches
every `Date`/`formatTime` call plus google-sync.ts — see its original
2026-08-20 scoping note) and **#31 task attachments + activity log**
(genuinely new subsystems, not a slot-in). Both need a real scoping pass
with Justin before implementation, same reasoning the doc already had on
file for them — nothing new learned tonight changes that.

**Assessment**: three separate audits (iterations 2, 3, 4) independently
converged on "fresh Google Calendar gaps are scarce now" — this app's
Google Calendar parity is in a genuinely strong place. Next session's best
use of time is either scoping #46/#31 properly with Justin, or picking a
fresh angle (e.g. a live user-facing UI/UX pass, not another feature audit).

## Overnight Google Calendar parity session, iteration 5 (2026-08-21)
- [x] **Sync `Event.notes` with Google/Apple** (#51) — the notes field
      added in iteration 2 had a UI and round-tripped through this app's
      own ICS export/import, but `google-sync.ts`/`apple-sync.ts` never
      touched it on either sync path. Wired Google's `description` field
      both ways (`importFromGoogle`/`exportToGoogle`) and Apple's
      `DESCRIPTION` (via `event.description` on `ical.js`'s parsed
      `ICAL.Event`) on import only — Apple sync has no export function
      at all today, so there's no write direction to add it to.

## Overnight Google Calendar parity session, iteration 4 (2026-08-21)
Checked duplicate-event quick action, month-view drag-across-days for
all-day creation, search-query operators (#39), guest permission tiers,
declining with a note, and event-color inheritance order — all either
already adequate or genuinely lower-value than the one real gap found:

- [x] **Shared calendars had no show/hide toggle** (#50) — Google's
      sidebar lets you show/hide any "Other calendar" with a checkbox,
      no need to unsubscribe. This app's `CalendarShare` overlay (#44)
      was all-or-nothing: once shared with you, it always rendered, no
      way to declutter it short of asking the owner to revoke. Added
      `CalendarShare.hiddenByRecipient` (recipient-only field — the
      owner's grant/permission is untouched), a new
      `setCalendarShareHiddenAction` scoped to `sharedWithId` (not
      `ownerId` — this is the recipient's own view preference, not a
      grant change), a "Show on my calendar" checkbox per received share
      in `CalendarSharingManager`, and `page.tsx`'s shared-events query
      now filters `hiddenByRecipient: false`.

Deferred, not filed as its own issue: Google/Apple sync still don't
round-trip `Event.notes` (carried over from iteration 2). Still open:
#46 multi-timezone, #31 task attachments, #20 native integrations
(OAuth-blocked), #16 AI notetaker.

## Overnight Google Calendar parity session, iteration 3 (2026-08-21)
Continued the audit (event color count, single-event .ics download,
sync round-tripping notes, email reminders, RSVP nuance, search
operators, duplicate-event). Most already adequate or already-scoped
(8-color palette is a deliberate choice, not a parity gap; per-event
.ics export already exists via `/api/ics/export?eventId=`). One real
gap found and shipped:

- [x] **RSVP had no "Maybe"/tentative option** (#49) — guest RSVP
      (`RsvpStatus`, #34) only supported Accept/Decline. Added
      `TENTATIVE` to the enum (no migration needed — SQLite stores
      Prisma enums as plain `TEXT`, so a new variant is schema-compatible
      with existing rows with zero DDL change), a third "Maybe" button
      on the public `/rsvp/[token]` page (`RsvpClient.tsx`), and an
      amber status color for it in `EventModal`'s guest list (green/red/
      amber/zinc for Accepted/Declined/Tentative/Pending).

Deferred, noted but not filed as its own issue yet: Google/Apple sync
still don't read or write `Event.notes` (carried over from iteration 2).
Still open: #46 multi-timezone, #31 task attachments, #20 native
integrations (OAuth-blocked), #16 AI notetaker.

## Overnight Google Calendar parity session, iteration 2 (2026-08-21)
Continued the iteration-1 audit into areas not yet covered (working
location, RSVP nuance, event color count, notification channels,
event description text, print/density). Most checked out already
shipped or already scoped elsewhere. One real gap found and shipped:

- [x] **Event description/notes field** (#48) — `Event.notes` already
      existed in the schema and round-tripped through ICS import/export
      (`src/lib/ics.ts`'s `DESCRIPTION` line), but nothing in the app
      ever wrote to it: `EventModal` had no field for it at all, and
      `createEvent`/`updateEvent`/`updateEventOccurrence` never read a
      `notes` value from form data. Reused the existing `NotesEditor`
      component as-is (same one `TaskModal` already uses) rather than
      building a second notes editor, added a `notesFromFormData`
      helper (same shape as the other `*FromFormData` helpers), and
      threaded `notes` through the client-side `CalendarEvent`/
      `EventModalEvent` types and `page.tsx`'s per-master-id maps
      (same pattern `reminderMinutes`/`allDay` already used).

Deferred, not this iteration: Google/Apple sync don't read or write
`Event.notes` at all (`google-sync.ts` has no `description` handling) —
a real gap, but a separate one from "can you set it in this app's own
UI," and touches the sync code paths, not the modal; worth its own pass.
Still open from iteration 1: #46 multi-timezone, #31 task attachments,
#20 native integrations (OAuth-blocked), #16 AI notetaker.

## Overnight Google Calendar parity session, iteration 1 (2026-08-21)
Priority bar going forward is full Google Calendar feature parity (this
app is an explicit replacement/overlay for it), not just Motion parity.
Did a feature-by-feature pass over Google Calendar's actual surface
(event fields, reminders/notifications, view options, keyboard
shortcuts, search, quick-add, color palette, subscriptions, working
location, OOO auto-decline, print/offline) against what's already
shipped per this doc/the closed issues below — almost everything checked
out already done (ICS subscriptions #32, ICS import/export #33, guests+
RSVP #34, working hours #35, OOO/focus-time #36, world clock #37, NL
quick-add #38, search #39, recurring exceptions #40, shortcuts #41,
snooze #42, print #43, calendar sharing #44, group scheduling #45, an
8-color event palette). One real, previously-unnoticed gap found and
shipped:

- [x] **Per-event customizable reminder** (#47) — the browser
      notification reminder was a single hardcoded global 10-minute
      window (`NotificationWatcher.tsx`'s old `NOTIFY_WITHIN_MIN`), with
      no per-event control and no way to turn it off, unlike Google
      Calendar's per-event None/5/10/30/60/1440-minute picker. New
      `Event.reminderMinutes Int? @default(10)` (null = no reminder);
      `EventModal` gets a "Reminder" select with those same presets.
      `getUpcomingEventReminders` (`src/app/actions.ts`) now filters by
      each occurrence's own `reminderMinutes` instead of a fixed window,
      widened its query window to the longest preset (1 day) to still
      catch them, and `NotificationWatcher.tsx` no longer re-checks a
      threshold client-side since the server already only returns
      occurrences that are due. `npx tsc --noEmit`, `npm test`, and
      `npm run build` all pass.

Still open, deliberately not this iteration's focus (see their own
issues for reasoning): #46 multi-timezone, #31 task attachments/activity
log, #20 broader native integrations (OAuth-blocked), #16 AI meeting
notetaker.

## Modal layout + all-day events (2026-08-21)
Two small user-reported fixes, then an overnight self-directed session
kicked off at the end (see the "Overnight Google Calendar parity
session" entry above).

- [x] **EventModal/TaskModal were taller than the screen** — both were a
      single narrow (`max-w-md`) column of stacked fields. Widened both
      to `max-w-2xl`, regrouped fields into 2-column grids (Title/
      Meeting link, Color/Event type, Start/End, Project/Assignee,
      Color/Min chunk), and gave `EventModal` the same
      `max-h-[85vh] overflow-y-auto` safety net `TaskModal` already had.
      Net effect: wider and noticeably shorter, fits on screen without
      scrolling on most laptop displays.
- [x] **All-day events** — `Event.allDay` already existed in the schema
      and was fully wired through Google/Apple/ICS sync and the
      calendar's own all-day banner row/layout, but there was no way to
      *set* it from the UI. Added an "All day" checkbox to `EventModal`;
      checking it swaps the Start/End time inputs for date-only pickers
      (end shown as the inclusive last day). Stored `end` is normalized
      to the exclusive day-after on submit — the same convention
      `google-sync.ts`/`ics.ts`/`layoutAllDayEvents` already assumed, so
      no display-side code needed to change. Wired into `createEvent`,
      `updateEvent`, and `updateEventOccurrence` (`allDayFromFormData`,
      same pattern as the existing `locked` checkbox).

Deliberately not done: a UI to *drag* across multiple days in month view
and have it auto-check All day — the checkbox is fully functional for
that case already (pick a date range), just not automatic yet.

## Issue backlog clear-out session (2026-08-20, headless)
Worked every open GitHub issue in one pass: 15 closed, 2 correctly
identified as already-shipped-but-uncommitted and just needed
committing (#3, #44's month-view gap), 4 left deliberately open (below).

Shipped this session — #3 (bulk move via multi-select, found already
built, just closed with an explanation), #32 (ICS subscriptions), #33
(ICS import/export), #34 (event guests + RSVP), #35 (working hours
setting), #36 (out-of-office/focus-time event types), #37 (world
clock), #38 (natural-language quick-add for events), #39 (search
across calendar events), #40 (recurring event exceptions — edit/delete
a single occurrence), #41 (keyboard shortcuts help overlay), #42
(snooze a notification), #43 (print view), #44 (calendar sharing —
closed the month-view gap the prior session's v1 left open), #45
(group scheduling — confirmed v1 already complete, closed).

**Left open, deliberately:**
- **#46 Multi-timezone support** — a real architecture change (every
  event time is currently a single machine-local Date; needs either
  UTC-storage-plus-display-timezone or true per-user timezone-aware
  storage, touching google-sync.ts, the hour-grid, and every
  `formatTime`-family call). Bigger than a slot in this pass; the two
  small timezone features that *don't* need it (#37 world clock, #35
  working hours) are done. Next session should scope this on its own.
- **#31 Task attachments + activity/comment log** — genuinely new
  subsystems (file storage beyond the existing image-upload route;
  a comment/activity table + UI), not a slot-in addition to something
  that already exists. Needs its own scoping pass.
- **#20 Broader native integrations (Zoom/Slack/Gmail)** — still
  blocked on OAuth app registrations only the account owner can create.
- **#16 AI meeting notetaker** — still needs a real audio/transcription
  pipeline, not just a Claude API call; lower priority than everything
  else on this list per its own issue text.

Also renamed `GoogleSyncWatcher.tsx` -> `SyncWatcher.tsx` once it
started polling ICS subscriptions too, not just Google.

## "Complete calendar replacement" audit + group features session (2026-08-20)
Goal: (1) verify optimization, (2) audit against Google Calendar feature-
by-feature and file real gaps as GitHub issues so nothing gets lost
across sessions, (3) build the group-collaboration features explicitly
asked for (calendar sharing, group scheduling). Three research passes,
then implementation.

**Issue triage**: closed #1 (forgot password — done 2026-08-19). Narrowed
#31 to just "task attachments + activity log" — the other four things it
listed were all already done (auto-scheduled indicator, hard deadline,
duration chunks, rich-text notes).

**Optimization audit** — one real finding, fixed: `fetchBusyIntervals`
(src/lib/scheduler.ts, the hottest function in the scheduler — called on
every schedule/reschedule) had an unbounded lower bound on its one-off
event query, fetching *every event the account has ever had* instead of
just ones overlapping the search window. Fixed to a proper interval-
overlap check, same pattern `page.tsx`'s own event query already used
correctly. Also added `@@index([userId, start])` on `Event` and
`@@index([userId, status])`/`@@index([userId, dueAt])` on `Task` —
free, zero-risk, ahead of rows accumulating over months. Everything else
checked out clean (no N+1s, no unscoped queries, no bundle warnings).

**Google Calendar parity audit** — filed issues #32–#43 for genuine gaps:
subscribing to external/ICS calendars (#32), ICS import/export (#33),
event guests + RSVP (#34), explicit working-hours setting (#35),
out-of-office/focus-time event types (#36), world clock (#37), natural-
language quick-add for events (#38), search across calendar events (#39),
recurring event exceptions — edit/delete a single occurrence (#40,
flagged **large** and central to any "complete" claim — this is one of
the most common real-world recurring-event actions), keyboard shortcuts
help overlay (#41), notification snooze (#42), print view (#43, low
value, filed for completeness only). Confirmed NOT gaps: booking/
appointment scheduling already matches or exceeds Google's own
Appointment Schedules; a separate Google-Tasks-style sidebar is moot
given this app's own richer Task system; birthdays/contacts integration
is noise for a personal self-hosted app.

**Group scheduling research + shipped v1**: real accounts already exist
(no per-teammate calendar data on `Assignee`, which is just a label under
the owning account — only `User` accounts have real busy-time). Filed
#46 (multi-timezone support, a real prerequisite once "group" can mean
different timezones) as a separate follow-up. Then shipped:
- [x] **Calendar sharing** (#44 in progress, v1 shipped) — new
      `CalendarShare` model (owner/sharedWith/permission: BUSY_ONLY or
      FULL_DETAILS), Settings → Calendars → "Calendar sharing" to grant/
      revoke by email, and a read-only diagonal-stripe overlay on the
      week/day grid. BUSY_ONLY never sends the real title to the browser
      at all, not just hides it client-side. No edit permission in v1 —
      that means rethinking every server action's ownership check, the
      exact bug class the 2026-08-19/20 security audits fixed. Month
      view doesn't show the overlay yet.
- [x] **Group scheduling — "find the best time for everyone"** (#45 in
      progress, v1 shipped) — `findGroupSlot` in scheduler.ts reuses the
      existing `fetchBusyIntervals`/`findEarliestSlot` primitives (union
      every participant's busy intervals, run the same earliest-slot
      search) — no new scheduling algorithm needed. New `/meet` page:
      pick participants from people who've shared their calendar with
      you (doubles as both authorization and the guarantee that real
      busy-time exists to intersect), pick a duration, get the earliest
      mutual slot, create it as a locked event. v1 scope: only real
      accounts (not Assignees), event lands on the requester's own
      calendar only (`Event.userId` is still singular), no timezone
      awareness yet (#46).

## Backlog catch-up session (2026-08-19, fourth pass)
Went through every open item in this doc against the actual codebase —
several sessions had shipped things (duration chunking, hard/soft
deadline precedence, drag-to-create, day-list sidebar, markdown notes,
video-call banner, multiple booking links, AI subtask generation, Apple
sync, invite-code gating) without this doc ever being updated to check
them off. Checkboxes below are now corrected to match reality. Then
implemented the remaining genuinely-open items:
- [x] **Task dependencies (Blocked By/Blocking)** — self-referential
      many-to-many on `Task` (`blockedBy`/`blocking`). A task with an
      unfinished blocker is skipped by the scheduler (`scheduleTask` in
      `src/lib/scheduler.ts` returns null, same signal as "no slot
      fits") — every caller (Schedule all, the per-task Schedule button,
      reschedule sweeps) routes through that one function. TaskModal
      gets a "Blocked by" picker; TaskRow shows a "Blocked" badge.
- [x] **Labels (tags)** — new `Label` model, many-to-many on `Task`.
      Manage them from Tasks page → "Manage labels" (same pattern as
      "Manage projects"); pick them per-task in TaskModal; shown as
      colored chips on TaskRow.
- [x] **Dense table list view** (`TaskTable.tsx`) — third view toggle
      (List/Board/Table) on the Tasks page. Grouped by Project, columns
      Title/Deadline/Status/Priority/Duration/Assignee, click a title to
      open the same edit modal as the other views.
- [x] **AI-generated project from one prompt** (`/tasks/generate-project`)
      — third mode on the existing `callAiForJson` pipeline (alongside
      syllabus import and AI subtasks). One-line prompt → project name +
      reviewable task list → creates the project and tasks on confirm.
- [x] **"No-meeting day" toggle on booking links** — `BookingLink.excludeDays`,
      same "SU,MO,..." format as `TimeSlot.daysOfWeek`. New
      `excludeDaysWindowFn` in scheduler.ts wraps the work-hours window;
      wired into both slot listing and the create-booking re-validation.
      Weekday toggle buttons in Settings → Booking links.
- [x] **"Auto-scheduled" badge copy** — TaskRow's "scheduled {date}" text
      now reads "auto-scheduled" vs "scheduled" based on `Event.locked`
      (a field that already existed for the lock icon).
- [x] **Real "forgot password" via emailed link** — the biggest flagged
      gap before public DNS. Generic SMTP (`src/lib/email.ts`, new
      `nodemailer` dependency) rather than picking one vendor — works
      with a Gmail app password, Postmark, Resend, or self-hosted Postfix
      via the same four env vars (`SMTP_HOST`/`PORT`/`USER`/`PASS`,
      see `.env.example`). `PasswordResetToken` model, 1-hour expiry,
      one-time use (every outstanding token for the user is invalidated
      once one is used), resets revoke all existing sessions same as a
      manual password change. Unset `SMTP_HOST` = the forgot-password
      page shows a setup message instead of erroring, same contract as
      the AI/local-AI features. New pages `/forgot-password`,
      `/reset-password`; "Forgot password?" link added to `/login`.

Not done, and deliberately left open (see reasoning already on file
below): Outlook calendar overlay (Apple already works via
`src/lib/apple-sync.ts`; Outlook needs its own OAuth app registration,
same blocker as issue #20's Zoom/Slack/Gmail), and the two items already
flagged "explicitly out of scope" (autonomous AI employees, enterprise
billing).

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
- [x] "Forgot password" reset via emailed link — SMTP-based, see the
      2026-08-19 fourth-pass session above.
- [x] Invite-gated signup — `SIGNUP_INVITE_CODE` env var, unset = open
      signup (today's default while this isn't shared beyond friends).
      Not full RBAC/access-control (still just "anyone with the code can
      make a full account"), but covers the "don't let a stranger who
      finds the URL sign up" gap.

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
- [x] **AI-assisted task creation with generated subtasks** —
      `src/lib/subtaskGenerate.ts`, wired to TaskRow's "Generate subtasks
      with AI" button. Context is deliberately scoped to just the task's
      own title/notes/project, not the whole task list — kept the
      privacy/scope story simple until there's a real reason to widen it.
      (The wider "one prompt → a whole new project" version is the
      separate `/tasks/generate-project` feature from the 2026-08-19
      fourth-pass session above.)
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
- [x] Multiple booking link types (different durations/slugs per user)
      — `BookingLinksManager` in Settings manages any number of links.
- [x] "Share availability" quick-copy message — Settings → Booking page
      → "Copy available times" copies a plain-text list of your next
      open slots to the clipboard, for pasting into an email/DM instead
      of sending the link.
- [x] "No-meeting day" toggle per booking link — see the 2026-08-19
      fourth-pass session above.

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
- [x] Video-call join banner ("Standup — starting in 1 min — Join call")
      — `MeetingBanner.tsx`, polls every 30s, shown on every page except
      the pre-auth ones.
- [x] Apple Calendar sync (`src/lib/apple-sync.ts`, wired in `actions.ts`)
- [ ] Outlook calendar overlay — needs its own OAuth app registration,
      same blocker as issue #20's Zoom/Slack/Gmail (only the account
      owner can create one).

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

- [x] Real "forgot password" — see the 2026-08-19 fourth-pass session
      above. This was the last flagged gap in this section.

## Server-action ownership re-audit (2026-08-19, fifth pass)
The fresh adversarial review this doc had been flagging as the last real
gap before public DNS — every exported function across the four
`"use server"` files (`actions.ts`, `authActions.ts`, `syllabusActions.ts`,
`projectActions.ts`) checked for the exact bug class the 2026-08-18 audit
found in `unscheduleTask`: a client-supplied id used to read/write a row
without actually scoping the query to the signed-in user.

Found and fixed — a real, previously-unfixed IDOR, not a false alarm:
- [x] **`createTask`/`updateTask` trusted `projectId`/`assigneeId`/
      `timeSlotId` straight from client FormData with no ownership
      check** — unlike `labelIds`/`blockedByIds` (added this session,
      which do verify), these three went in unverified back when the
      form only ever *sent* your own ids. Since they're plain cuids, not
      secret, a request crafted outside the UI could attach your own
      task to another user's real Project/Assignee/TimeSlot id, and that
      row's name/color would then render on your own task via
      `include: { project: true }` etc. — a real cross-tenant data leak,
      same shape as the unscheduleTask bug, just via a foreign-id field
      instead of a target-row id. Fixed with `verifyOwnedId()` in
      `actions.ts`: each id is confirmed to belong to the current user
      before being used, and silently dropped (not errored) if not —
      same "drop invalid state quietly" convention already used
      elsewhere in `taskFieldsFromFormData`.
- [x] Same bug, same fix, in `importSyllabusTasksAction`
      (`syllabusActions.ts`, `projectId`/`assigneeId`) and
      `createProjectFromPlanAction` (`projectActions.ts`,
      `assigneeId` — its `projectId` is the row just created, not
      client-supplied, so that one didn't need it).

Reviewed and judged not a real issue:
- `createAutomationRuleAction`'s `projectId` is also unverified, but
  automation rules only ever evaluate the *current* user's own task
  status changes against `rule.projectId` — a foreign project id just
  never matches any of the attacker's own tasks, so the rule is inert,
  not a leak. Left as-is rather than adding a check with no exploitable
  behavior behind it.
- `forgotPasswordAction`/`resetPasswordAction` (added this session):
  no user-enumeration oracle (same response either way), reset token is
  an unguessable 32-byte random value looked up by itself (not by a
  client-supplied user id), and is single-use (every outstanding token
  for the user is deleted once one succeeds). No issue found.
- Every other exported action in all four files was already scoping its
  `where` by `userId: user.id` (or, for the two genuinely public
  endpoints — `createBookingAction`/booking-page lookups — resolving the
  target row server-side from a slug, never trusting a client-supplied
  row id). Nothing else to fix.

`npx tsc --noEmit`, `npm test`, and `npm run build` all pass after the fix.

## Explicitly out of scope for now
- Autonomous AI employees actually doing tasks (needs a real design
  conversation about what "do the task" means per task type — deferred
  on purpose, not forgotten)
- Enterprise/team billing, org-wide admin — this is "you + friends you
  trust," not a multi-tenant SaaS

---
## Before the public DNS / sharing with friends
Login rate limiting, change-password, session revocation UX, real
forgot-password, and a fresh adversarial ownership-check review (2026-08-19,
fifth pass above — found and fixed one real IDOR) all now exist. What's
left before this is actually public: deciding whether invite-code-gated
signup is enough access control or whether real per-account roles are
needed. Flag this explicitly before sharing the link, not after.

**Proposed next 3 (superseded by the 2026-08-19 fourth-pass session
above, which built all three):** (1) pick an email provider and build real
forgot-password — the last real gap before this is public; (2)
AI-assisted task creation with generated subtasks — needs a design pass
on scope/context first; (3) mini month-picker + click-drag multi-select/
bulk-move on the calendar.

## Competitor research session (2026-08-19, third pass)
Triggered by the user sharing real Motion screenshots (task detail panel,
date-picker popup, list view, project page) mid-session while several
concrete asks from those screenshots were already being implemented in
parallel: drag-to-create popup (task vs. event choice) with a lock icon
for manually-placed blocks, event/task left-border-only color styling,
moving the "now" line, a day-list sidebar on the calendar page, task
hard-vs-soft deadline (hard default), and duration chunking into
sub-blocks with gaps. None of those are re-proposed below — this session
looked for what's still missing beyond them.

Confirmed via Motion's own help docs (not just review-site paraphrase):
Motion's scheduling engine has a documented priority order — **ASAP
tasks, then hard deadlines, then soft deadlines, then priority, then
duration, then chunking rules**. This app is adding hard-vs-soft deadline
as a field, but the scheduler itself (`src/lib/scheduler.ts`) only scores
by priority + due date today, with no explicit hard/soft precedence tier.
- [x] **Scheduler precedence for hard vs. soft deadlines** — once the
      field exists, a hard-deadline task should bump ahead of a
      higher-priority soft-deadline task if the soft one still has slack
      before its own due date and the hard one doesn't. Worth stating
      explicitly now since it's the actual point of adding the field —
      a hard/soft toggle that doesn't change scheduling order is just a
      label.
- [x] **Chunking confirmed mechanics** (for whoever builds it): Duration
      = total estimate, Min chunk = size per block, Motion auto-splits
      into N blocks that still finish before the deadline if hard. This
      app's existing per-user `bufferMin` already inserts breathing room
      between *any* two scheduled items — worth checking whether that's
      reused as the inter-chunk gap or whether chunked blocks need their
      own (probably larger) gap knob, since "gap between two unrelated
      tasks" and "gap between two chunks of the same task" aren't
      obviously the same number.

Genuinely new, not yet tracked:
- [x] **Task dependencies (Blocked By / Blocking)** — visible on Motion's
      own task panel in the screenshots ("Blocked By: None / Blocking:
      None"). Nothing like this exists in `Task` today beyond the
      one-level parent/subtask checklist relation. Real scheduler
      implication, not just a UI field: a blocked task shouldn't be
      auto-scheduled until its blockers are Done. Medium effort — a
      self-referential many-to-many on Task, plus one guard in the
      scheduler's sweep.
- [x] **Labels (tags)** on tasks — Motion's panel shows "Labels: None."
      A lightweight many-to-many tag, not a full custom-field builder —
      Motion also offers "+ Add custom field" but a generic custom-field
      system for a personal/small-group app is speculative flexibility
      nobody's asked for yet; skip that part, labels alone cover most of
      the real want (quick visual grouping cross-cutting projects).
- [x] **Dense table list view** (Deadline/Status/Priority/Duration/
      Assignee columns, grouped by Project → Status, per Motion's list
      view screenshot) — this app's existing Tasks page already has
      List/Board(Kanban) view toggles, but "List" today is the same
      card-row `TaskRow` layout as the default view, not a dense
      multi-column table. A real information-density gap for anyone
      managing more than a handful of tasks at once.
- [x] **"No-meeting day" toggle on booking links** — confirmed as a real
      Reclaim.ai feature (declines booking attempts on designated days),
      Sunsama doesn't have it. Small, concrete: exclude specific
      weekdays from a `BookingLink`'s computed availability. Could reuse
      the existing `TimeSlot.daysOfWeek` string pattern rather than
      inventing a new format.
- [x] **"Auto-scheduled on {date}" badge copy** — Motion's panel
      explicitly labels a slot as auto-scheduled vs. not. Not a new
      feature on its own, but pairs directly with the lock icon already
      being built this session: once a block can be locked (manual) or
      unlocked (scheduler-owned), showing *when* the scheduler placed it
      is the natural companion — flag for whoever does that UI so the
      copy isn't an afterthought.
- [x] **AI-generated project from one prompt** — Motion: write one
      prompt, get a full project + task breakdown. This app already has
      the two halves separately (AI syllabus import parses text into a
      reviewable task list; AI subtask generation breaks one task into
      subtasks) and the same `callAiForJson` infra both already use —
      a "describe a project, get a reviewable list of tasks under a new
      Project" feature is a natural third mode on that same pipeline,
      not a new subsystem. Medium effort, high fit.

Looked at and deliberately not proposing:
- **Workspaces above Projects** (Motion: Workspace > Project > Task,
  this app: flat Project > Task) — a second hierarchy level is
  speculative structure for a "you + a few friends" self-hosted app
  unless there's an actual want to separate genuinely distinct contexts
  (e.g. personal vs. one specific client's work). Existing per-project
  color-coding already gives visual grouping. Add only if a real need
  shows up, not because Motion has the layer.
- **Fine-grained buffer types** (Reclaim: separate travel-time-by-
  location, post-meeting decompression time, task/habit breaks, vs. this
  app's one global `bufferMin`) — real distinction, but three new knobs
  for a personal app is over-fit; the one global buffer already covers
  the common case. Revisit only if a specific buffer type is actually
  missed in practice.
- **Team capacity/workload views, custom-field builder** — same
  reasoning as the existing "Explicitly out of scope" section
  (enterprise/team surface, speculative flexibility) — not revisited.

**Top 5, most impactful/feasible first — all five now shipped, see the
2026-08-19 fourth-pass session at the top of this doc:**
1. ~~Scheduler precedence for hard vs. soft deadlines~~ — done in an
   earlier same-day session (`442e5c1`).
2. ~~Task dependencies (Blocked By/Blocking)~~ — done.
3. ~~Dense table list view~~ — done.
4. ~~AI-generated project from one prompt~~ — done.
5. ~~Labels (tags)~~ — done.
