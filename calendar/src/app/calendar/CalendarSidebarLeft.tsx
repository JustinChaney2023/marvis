"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { formatYMD, parseYMD, type CalendarView } from "@/lib/calendar-dates";
import Card from "../ui/Card";
import { useNowContext } from "./NowContext";
import { useCalendarVisibility } from "./CalendarVisibilityContext";

// Same swatch colors as PROJECT_EVENT_COLORS' `dot`, kept local since
// these three are fixed (not user-chosen like a project's color).
const MY_CALENDARS = [
  { key: "events", label: "My Calendar", dot: "bg-indigo-500" },
  { key: "tasks", label: "Tasks", dot: "bg-blue-500" },
] as const;
const HABITS_CALENDAR = { key: "habits", label: "Habits", dot: "bg-green-500" } as const;

function CalendarCheckbox({
  calendarKey,
  label,
  dot,
}: {
  calendarKey: string;
  label: string;
  dot: string;
}) {
  const { isVisible, toggle } = useCalendarVisibility();
  const checked = isVisible(calendarKey);
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-ink-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(calendarKey)}
        className={`h-3.5 w-3.5 rounded-sm accent-current ${dot.replace("bg-", "text-")}`}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

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
  hasHabits = false,
  subscriptions = [],
}: {
  view: CalendarView;
  startYMD: string;
  hasHabits?: boolean;
  subscriptions?: { id: string; name: string }[];
}) {
  const start = parseYMD(startYMD);
  const [cursor, setCursor] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const router = useRouter();
  const { triggerScrollToNow } = useNowContext();
  const today = new Date();
  const cells = buildMonthGrid(cursor);

  const goToDay = (d: Date) => {
    router.push(`/?view=${view === "month" ? "day" : view}&start=${formatYMD(d)}`);
  };

  // Same behavior the button used to have on the calendar toolbar: if
  // you're already looking at today, just scroll the hour grid to the
  // current time instead of a no-op navigation to the URL you're on.
  const goToNow = () => {
    if (startYMD === formatYMD(today)) {
      triggerScrollToNow();
    } else {
      router.push(`/?view=${view}&start=${formatYMD(today)}`);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Card padding="sm">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-rule-soft"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
          </button>
          <span className="font-serif text-lg">
            {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="Next month"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-rule-soft"
          >
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-y-1 text-center font-mono text-[9px] text-muted">
          {WEEKDAY_INITIALS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center font-mono text-xs">
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
                    ? "mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-ink font-semibold text-paper"
                    : isToday
                      ? "mx-auto flex h-6 w-6 items-center justify-center rounded-full border border-accent font-semibold text-ink"
                      : "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-ink-2 hover:bg-rule-soft"
                }
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </Card>
      {view !== "month" && (
        <button
          type="button"
          onClick={goToNow}
          className="rounded-lg border border-rule bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-rule-soft"
        >
          Now
        </button>
      )}
      <Card padding="sm">
        <p className="font-serif text-sm">My calendars</p>
        <div className="mt-1.5 flex flex-col">
          {MY_CALENDARS.map((c) => (
            <CalendarCheckbox key={c.key} calendarKey={c.key} label={c.label} dot={c.dot} />
          ))}
          {hasHabits && (
            <CalendarCheckbox
              calendarKey={HABITS_CALENDAR.key}
              label={HABITS_CALENDAR.label}
              dot={HABITS_CALENDAR.dot}
            />
          )}
        </div>
      </Card>
      {subscriptions.length > 0 && (
        <Card padding="sm">
          <p className="font-serif text-sm">Other calendars</p>
          <div className="mt-1.5 flex flex-col">
            {subscriptions.map((s) => (
              <CalendarCheckbox
                key={s.id}
                calendarKey={`sub:${s.id}`}
                label={s.name}
                dot="bg-zinc-400"
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
