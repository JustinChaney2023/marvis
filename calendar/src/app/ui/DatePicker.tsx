"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildMonthGrid,
  formatYMD,
  getQuickPickOptions,
  parseYMD,
  WEEKDAY_INITIALS,
} from "@/lib/calendar-dates";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "../icons";

type Props = {
  name: string;
  value: string; // YYYY-MM-DD, or "" for unset
  onChange: (ymd: string) => void;
  placeholder?: string;
};

/**
 * A nicer replacement for a bare `<input type="date">` — a button
 * showing the picked date, opening a popup with a Motion-style quick-
 * pick shortcut list next to a real month grid. Wraps a hidden input so
 * it still submits as a plain form field (`name`), same as the native
 * input it replaces.
 */
export default function DatePicker({ name, value, onChange, placeholder = "Pick a date" }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const selected = value ? parseYMD(value) : null;
  const [cursor, setCursor] = useState(() =>
    selected
      ? new Date(selected.getFullYear(), selected.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const containerRef = useRef<HTMLDivElement>(null);

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

  const pick = (d: Date) => {
    onChange(formatYMD(d));
    setOpen(false);
  };

  const cells = buildMonthGrid(cursor);
  const quickPicks = getQuickPickOptions(today);

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => {
          setCursor(
            selected
              ? new Date(selected.getFullYear(), selected.getMonth(), 1)
              : new Date(today.getFullYear(), today.getMonth(), 1),
          );
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
      >
        <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
        <span className={value ? "" : "text-zinc-400"}>
          {selected
            ? selected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : placeholder}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="ml-auto text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <CloseIcon className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 flex w-max overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex flex-col gap-0.5 border-r border-zinc-200 p-2 dark:border-zinc-700">
            {quickPicks.map((qp) => (
              <button
                key={qp.label}
                type="button"
                onClick={() => pick(qp.date)}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <span>{qp.label}</span>
                <span className="text-zinc-400">
                  {qp.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
              </button>
            ))}
          </div>

          <div className="p-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                aria-label="Show previous month"
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
                aria-label="Show next month"
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
                const isToday = formatYMD(d) === formatYMD(today);
                const isSelected = value === formatYMD(d);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(d)}
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
        </div>
      )}
    </div>
  );
}
