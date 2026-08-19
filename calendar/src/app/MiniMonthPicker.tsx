"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { formatYMD, parseYMD, type CalendarView } from "@/lib/calendar-dates";

const WEEKDAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function buildMonthGrid(monthDate: Date): (Date | null)[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // 0=Sun
  const cells: (Date | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

export default function MiniMonthPicker({
  view,
  startYMD,
}: {
  view: CalendarView;
  startYMD: string;
}) {
  const [open, setOpen] = useState(false);
  const start = parseYMD(startYMD);
  const [cursor, setCursor] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const today = new Date();

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const cells = buildMonthGrid(cursor);

  const goToDay = (d: Date) => {
    router.push(`/?view=${view === "month" ? "day" : view}&start=${formatYMD(d)}`);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setCursor(new Date(start.getFullYear(), start.getMonth(), 1));
          setOpen((v) => !v);
        }}
        aria-label="Jump to date"
        title="Jump to date"
        className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      >
        <CalendarIcon className="h-4 w-4" />
      </button>

      {open && (
        <>
          {/* Mobile only: dims the page and gives a tap-outside target,
              same job the popover's click-outside listener does on
              desktop, but a bare click-outside is easy to miss on a
              phone without something visibly separating the sheet. */}
          <div
            className="fixed inset-0 z-30 bg-black/30 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-40 w-full rounded-t-2xl border-t border-zinc-200 bg-white p-4 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:bottom-auto sm:w-64 sm:rounded-xl sm:border sm:p-3 sm:shadow-lg sm:ring-1 sm:ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
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
          </div>
        </>
      )}
    </div>
  );
}
