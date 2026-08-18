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

## Data model

- `Task` — title, priority, duration estimate, optional due date. This is the scheduling input.
- `Event` — a placed block on the calendar, optionally linked back to the `Task` it was scheduled from.

## Status

v0: task list with create/complete. No calendar grid, auto-scheduling, or external calendar sync yet — those are next.
