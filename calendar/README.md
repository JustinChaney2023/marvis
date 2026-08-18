# Marvis Calendar

Personal calendar/task planner — a Motion-style auto-scheduling tool, being built as a standalone app for now. See `../docs/motion.md` and `../docs/fluidcalendar.md` for the product references it's modeled after.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- SQLite via Prisma (`prisma/schema.prisma`) — single-user, no DB server to run
- Server Actions for writes, no separate API layer

## Dev setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Note: `tsc --noEmit` depends on Next's generated route types (`.next/types/`),
which only exist after `next dev` or `next build` has run at least once on a
fresh clone — run `npm run dev` (or `npx next typegen`) before typechecking.

## Data model

- `Task` — title, priority, duration estimate, optional due date. This is the scheduling input.
- `Event` — a placed block on the calendar, optionally linked back to the `Task` it was scheduled from.

## Auto-scheduling

`src/lib/scheduler.ts` places `TODO` tasks into free work-hour slots
(Mon–Fri, 9am–6pm, 15-min granularity), ordered by due date then priority —
same weighting order as FluidCalendar, simplified to a strict sort. Each
placement creates/updates the linked `Event` and flips the task to
`SCHEDULED`. "Schedule all" runs this over every open task sequentially, so
earlier (more urgent) tasks claim the better slots.

## Status

v0: task list with create/complete/schedule/unschedule, a `/calendar` week
view (create/delete events, prev/next week nav), and the auto-scheduler
above. No external calendar sync, drag-and-drop rescheduling, or recurring
events yet — those are next.
