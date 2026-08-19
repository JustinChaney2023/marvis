"use client";

import { useState } from "react";
import { createTimeSlotAction, deleteTimeSlotAction } from "../actions";
import Button from "../ui/Button";

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAYS_DEFAULT = ["MO", "TU", "WE", "TH", "FR"];

export type TimeSlotData = {
  id: string;
  name: string;
  daysOfWeek: string;
  startMin: number;
  endMin: number;
};

function formatTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDays(daysOfWeek: string): string {
  const days = daysOfWeek.split(",");
  if (WEEKDAYS_DEFAULT.every((d) => days.includes(d)) && days.length === 5) return "Weekdays";
  if (days.length === 7) return "Every day";
  return days.map((d) => WEEKDAY_SHORT[WEEKDAY_CODES.indexOf(d as (typeof WEEKDAY_CODES)[number])]).join(", ");
}

export default function TimeSlotsManager({ timeSlots }: { timeSlots: TimeSlotData[] }) {
  const [adding, setAdding] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>(WEEKDAYS_DEFAULT);

  return (
    <div className="flex flex-col gap-3">
      {timeSlots.map((slot) => (
        <div
          key={slot.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-600"
        >
          <p>
            <span className="font-medium">{slot.name}</span>{" "}
            <span className="text-zinc-500">
              — {formatDays(slot.daysOfWeek)}, {formatTime(slot.startMin)}–{formatTime(slot.endMin)}
            </span>
          </p>
          <form action={deleteTimeSlotAction.bind(null, slot.id)}>
            <button
              type="submit"
              className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              Delete
            </button>
          </form>
        </div>
      ))}
      {timeSlots.length === 0 && <p className="text-sm text-zinc-400">No time slots yet.</p>}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Add time slot
        </button>
      ) : (
        <form
          action={async (formData) => {
            await createTimeSlotAction(formData);
            setAdding(false);
            setSelectedDays(WEEKDAYS_DEFAULT);
          }}
          className="flex flex-col gap-3 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-600"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Name
            <input
              name="name"
              required
              placeholder="e.g. Work, Sleep, School"
              className="w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>

          <div className="flex flex-col gap-1 text-xs text-zinc-500">
            Days
            <div className="flex gap-1">
              {WEEKDAY_CODES.map((code, i) => {
                const selected = selectedDays.includes(code);
                return (
                  <label key={code} className="flex flex-col items-center gap-0.5">
                    <input
                      type="checkbox"
                      name={`day_${code}`}
                      checked={selected}
                      onChange={() =>
                        setSelectedDays((prev) =>
                          prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
                        )
                      }
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedDays((prev) =>
                          prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
                        )
                      }
                      className={
                        selected
                          ? "flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white"
                          : "flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 text-xs font-semibold text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
                      }
                    >
                      {WEEKDAY_SHORT[i]}
                    </button>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Start
              <input
                name="startTime"
                type="time"
                defaultValue="09:00"
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              End
              <input
                name="endTime"
                type="time"
                defaultValue="18:00"
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </label>
            <Button type="submit">Add</Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
