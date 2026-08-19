"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { formatYMD, parseYMD, type CalendarView } from "@/lib/calendar-dates";
import Card from "../ui/Card";

const WEEKDAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function buildMonthGrid(monthDate: Date): (Date | null)[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (Date | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

// Permanently-visible companion to the header's MiniMonthPicker popover
// — this app has room either side of the calendar on wide screens
// (hidden below `lg`, same as the right sidebar), a good spot to surface
// date-jumping without needing a click first, and a natural home for
// future additions later.
export default function CalendarSidebarLeft({
  view,
  startYMD,
}: {
  view: CalendarView;
  startYMD: string;
}) {
  const start = parseYMD(startYMD);
  const [cursor, setCursor] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const router = useRouter();
  const today = new Date();
  const cells = buildMonthGrid(cursor);

  const goToDay = (d: Date) => {
    router.push(`/?view=${view === "month" ? "day" : view}&start=${formatYMD(d)}`);
  };

  return (
    <Card padding="sm">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="Previous month"
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-medium">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="Next month"
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center text-[10px] text-zinc-400">
        {WEEKDAY_INITIALS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const isToday =
            d.getFullYear() === today.getFullYear() &&
            d.getMonth() === today.getMonth() &&
            d.getDate() === today.getDate();
          const isSelected = formatYMD(d) === startYMD;
          return (
            <button
              key={i}
              type="button"
              onClick={() => goToDay(d)}
              className={
                isSelected
                  ? "mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white"
                  : isToday
                    ? "mx-auto flex h-6 w-6 items-center justify-center rounded-full border border-indigo-500 text-indigo-600 dark:text-indigo-400"
                    : "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
