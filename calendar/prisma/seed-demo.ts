// One-off seed for the public demo/guest account (useseason.app portfolio
// link). Re-runnable: wipes and recreates the demo user by email so it can
// be refreshed without piling up duplicate data. Not part of `npm test` or
// any build step — run manually with `npx tsx prisma/seed-demo.ts`.
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { scheduleAllPendingTasks } from "@/lib/scheduler";

const DEMO_EMAIL = "demo@useseason.app";
const DEMO_PASSWORD = "SeasonDemo2026!";

function daysFromNow(days: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: hashPassword(DEMO_PASSWORD),
      name: "Demo Account",
      isAdmin: false,
      // Match the server's own zone (America/Anchorage) — daysFromNow()
      // below builds Date objects from the server's local wall clock, so
      // the scheduler's work-hour window needs the same zone or its
      // "9am-6pm" bucketing lands several hours off from the events this
      // script hand-places (e.g. the 10am lecture).
      timezone: "America/Anchorage",
    },
  });
  const userId = user.id;

  await prisma.timeSlot.create({
    data: { userId, name: "Work", daysOfWeek: "MO,TU,WE,TH,FR", startMin: 9 * 60, endMin: 18 * 60 },
  });
  const schoolSlot = await prisma.timeSlot.create({
    data: { userId, name: "School", daysOfWeek: "MO,WE,FR", startMin: 8 * 60, endMin: 16 * 60 },
  });

  const [website, algorithms] = await Promise.all([
    prisma.project.create({
      data: {
        userId,
        name: "Website Redesign",
        color: "amber",
        notes: "Client-facing marketing site refresh — new visual system, faster load, mobile-first.",
      },
    }),
    prisma.project.create({
      data: {
        userId,
        name: "CS 201 — Algorithms",
        color: "indigo",
        notes: "Second-year algorithms course. Two lectures + one discussion section per week.",
        fields: {
          create: [
            { key: "instructor", label: "Instructor", value: "Dr. A. Whitfield", sortOrder: 0 },
            { key: "office_hours", label: "Office Hours", value: "Tue/Thu 2:00–3:30pm, Rm 214", sortOrder: 1 },
            { key: "grading", label: "Grading", value: "Homework 30% · Midterm 30% · Final 40%", sortOrder: 2 },
            { key: "books", label: "Required Books", value: "Introduction to Algorithms (CLRS), 4th ed.", sortOrder: 3 },
          ],
        },
      },
    }),
  ]);

  const label = await prisma.label.create({ data: { userId, name: "urgent-client", color: "amber" } });

  // Recurring lecture — shows off recurrence + the School time slot.
  await prisma.event.create({
    data: {
      userId,
      title: "CS 201 Lecture",
      location: "Rm 214",
      start: daysFromNow(0, 10),
      end: daysFromNow(0, 11, 15),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      color: "indigo",
      locked: true,
    },
  });

  // A meeting with a video link, to show MeetingBanner.
  await prisma.event.create({
    data: {
      userId,
      title: "Client sync — Website Redesign",
      meetingUrl: "https://meet.google.com/demo-showcase-call",
      start: daysFromNow(0, 14),
      end: daysFromNow(0, 14, 30),
      color: "amber",
    },
  });

  // Locked focus block + out-of-office, to show those event types.
  await prisma.event.create({
    data: {
      userId,
      title: "Focus time",
      eventType: "FOCUS_TIME",
      locked: true,
      start: daysFromNow(1, 9),
      end: daysFromNow(1, 11),
    },
  });
  await prisma.event.create({
    data: {
      userId,
      title: "Out of office",
      eventType: "OUT_OF_OFFICE",
      locked: true,
      allDay: true,
      start: daysFromNow(4, 0),
      end: daysFromNow(5, 0),
    },
  });

  // Tasks — a spread of status/priority/due dates, one with subtasks,
  // one overdue, one already done, plus plain unscheduled ones the
  // scheduler will place below.
  const heroTask = await prisma.task.create({
    data: {
      userId,
      title: "Redesign homepage hero section",
      notes: "New copy from marketing is in; needs a layout that works down to 375px wide.",
      projectId: website.id,
      priority: 3,
      energy: "HIGH",
      durationMin: 120,
      dueAt: daysFromNow(3, 17),
      labels: { connect: { id: label.id } },
    },
  });
  await prisma.task.createMany({
    data: [
      {
        userId,
        title: "Export brand assets for dev handoff",
        projectId: website.id,
        priority: 1,
        energy: "LOW",
        durationMin: 30,
        parentId: heroTask.id,
        status: "DONE",
      },
      {
        userId,
        title: "Write alt text for hero images",
        projectId: website.id,
        priority: 1,
        energy: "LOW",
        durationMin: 20,
        parentId: heroTask.id,
      },
    ],
  });

  await prisma.task.create({
    data: {
      userId,
      title: "Problem set 4",
      notes: "Dynamic programming — problems 1-6.",
      projectId: algorithms.id,
      timeSlotId: schoolSlot.id,
      priority: 2,
      energy: "HIGH",
      durationMin: 90,
      dueAt: daysFromNow(2, 23, 59),
    },
  });
  await prisma.task.create({
    data: {
      userId,
      title: "Read chapter 7 — Greedy algorithms",
      projectId: algorithms.id,
      timeSlotId: schoolSlot.id,
      priority: 0,
      energy: "MEDIUM",
      durationMin: 45,
      dueAt: daysFromNow(6, 23, 59),
    },
  });

  await prisma.task.create({
    data: {
      userId,
      title: "Renew car registration",
      priority: 2,
      energy: "LOW",
      durationMin: 20,
      dueAt: daysFromNow(-1, 17), // overdue — shows the "needs attention" surfacing
      hardDeadline: false,
    },
  });
  await prisma.task.create({
    data: {
      userId,
      title: "Book dentist appointment",
      priority: 0,
      energy: "LOW",
      durationMin: 15,
      status: "DONE",
    },
  });
  await prisma.task.create({
    data: {
      userId,
      title: "Prep slides for client walkthrough",
      notes: "Cover the new hero section, updated nav, and the mobile flow.",
      projectId: website.id,
      priority: 2,
      energy: "MEDIUM",
      durationMin: 60,
      dueAt: daysFromNow(3, 13, 30),
    },
  });
  await prisma.task.create({
    data: {
      userId,
      title: "Grocery run",
      priority: 0,
      energy: "LOW",
      durationMin: 30,
    },
  });

  // Habit, to show the Habits settings tab / weekly-recurring blocks.
  await prisma.habit.create({
    data: { userId, title: "Morning workout", durationMin: 45, timesPerWeek: 4, priority: 1 },
  });

  // Booking link, to show the public scheduling page.
  await prisma.bookingLink.create({
    data: {
      userId,
      slug: "demo-intro-call",
      title: "15-min intro call",
      durationMin: 15,
      minNoticeMin: 120,
    },
  });

  // Let the real scheduler place every unscheduled task, exactly like
  // clicking "Schedule all" would — realistic calendar density instead
  // of hand-picked event times.
  await scheduleAllPendingTasks(userId);

  console.log(`Demo account ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
