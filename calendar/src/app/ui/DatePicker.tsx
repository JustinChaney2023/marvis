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
        className="flex w-full items-center gap-2 rounded-lg border border-rule bg-surface px-3 py-2 text-left text-[13px] transition-colors hover:border-ink-2"
      >
        <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
        <span className={value ? "" : "text-muted"}>
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
            className="ml-auto text-muted hover:text-ink"
          >
            <CloseIcon className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 flex w-max overflow-hidden rounded-xl border border-rule bg-surface">
          <div className="flex flex-col gap-0.5 border-r border-rule p-2">
            {quickPicks.map((qp) => (
              <button
                key={qp.label}
                type="button"
                onClick={() => pick(qp.date)}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs text-ink-2 transition-colors hover:bg-rule-soft"
              >
                <span>{qp.label}</span>
                <span className="font-mono text-muted">
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
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-2 hover:bg-rule-soft"
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
              </button>
              <span className="font-serif text-base">
                {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </span>
              <button
                type="button"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                aria-label="Show next month"
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-2 hover:bg-rule-soft"
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-y-1 text-center font-mono text-[10px] text-muted">
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
          </div>
        </div>
      )}
    </div>
  );
}
