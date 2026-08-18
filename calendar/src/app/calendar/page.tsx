import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createEvent, deleteEvent } from "../actions";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeekMonday(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  const monday = startOfDay(d);
  monday.setDate(monday.getDate() - offset);
  return monday;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatWeekRange(start: Date, end: Date): string {
  const yearStart = start.getFullYear();
  const yearEnd = end.getFullYear();
  const sameMonth = start.getMonth() === end.getMonth() && yearStart === yearEnd;
  const startStr = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start);
  const endStr = sameMonth
    ? end.getDate().toString()
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(end);
  if (yearStart === yearEnd) {
    return `${startStr} – ${endStr}, ${yearStart}`;
  }
  const full = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${full.format(start)} – ${full.format(end)}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const sp = await props.searchParams;
  const rawStart = sp?.start;
  const requested = Array.isArray(rawStart) ? rawStart[0] : rawStart;

  const today = new Date();
  const reference = (() => {
    if (requested) {
      const parsed = new Date(`${requested}T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return today;
  })();
  const weekStart = startOfWeekMonday(reference);
  const weekEnd = addDays(weekStart, 7);

  const events = await prisma.event.findMany({
    where: { start: { gte: weekStart, lt: weekEnd } },
    orderBy: { start: "asc" },
  });

  const byDay = new Map<string, typeof events>();
  for (const ev of events) {
    const key = formatYMD(ev.start);
    const list = byDay.get(key);
    if (list) list.push(ev);
    else byDay.set(key, [ev]);
  }

  const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const prevMonday = formatYMD(addDays(weekStart, -7));
  const nextMonday = formatYMD(addDays(weekStart, 7));
  const rangeText = formatWeekRange(weekStart, addDays(weekStart, 6));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Tasks
        </Link>
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href={`/calendar?start=${prevMonday}`}
            className="text-zinc-500 hover:underline"
          >
            ← Prev week
          </Link>
          <Link
            href={`/calendar?start=${nextMonday}`}
            className="text-zinc-500 hover:underline"
          >
            Next week →
          </Link>
        </nav>
      </header>

      <p className="mt-2 text-center text-sm text-zinc-500">{rangeText}</p>

      <div className="mt-6 overflow-x-auto">
        <div className="grid min-w-[56rem] grid-cols-7 gap-2">
          {days.map((day, idx) => {
            const key = formatYMD(day);
            const dayEvents = byDay.get(key) ?? [];
            const todayMark = isSameDay(day, today);
            return (
              <section
                key={key}
                className="flex min-h-[12rem] flex-col rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="mb-2 border-b border-zinc-100 pb-1 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-500">
                    {WEEKDAY_LABELS[idx]}
                  </div>
                  <div
                    className={
                      todayMark
                        ? "text-lg font-bold text-zinc-900 dark:text-zinc-50"
                        : "text-lg font-semibold text-zinc-700 dark:text-zinc-300"
                    }
                  >
                    {day.getDate()}
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {dayEvents.length === 0 ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-600">
                      No events
                    </p>
                  ) : (
                    dayEvents.map((ev) => (
                      <article
                        key={ev.id}
                        className="relative rounded border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <form
                          action={deleteEvent.bind(null, ev.id)}
                          className="absolute right-1 top-1"
                        >
                          <button
                            type="submit"
                            aria-label="delete event"
                            className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                          >
                            ×
                          </button>
                        </form>
                        <div className="pr-5 text-zinc-500 dark:text-zinc-400">
                          {formatTime(ev.start)} – {formatTime(ev.end)}
                        </div>
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {ev.title}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <form
        action={createEvent}
        className="mt-8 flex flex-wrap gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <input
          name="title"
          placeholder="Event title"
          required
          className="min-w-[16rem] flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="datetime-local"
          name="start"
          required
          className="rounded border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="datetime-local"
          name="end"
          required
          className="rounded border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Add event
        </button>
      </form>
    </main>
  );
}
