"use client";

import { useEffect, useState } from "react";
import { createBookingAction } from "../../actions";

export type BookingDay = {
  dayLabel: string;
  slots: string[]; // ISO strings
};

type Props = {
  title: string;
  durationMinutes: number;
  availability: BookingDay[];
};

type Confirmation = {
  dayLabel: string;
  slotIso: string;
};

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayHeading(dayLabel: string): string {
  // The lib passes `slot.toDateString()` (e.g. "Tue Aug 18 2026"); round-
  // tripping through `new Date` so we can `toLocaleDateString` it back to
  // a friendly long-form label.
  const parsed = new Date(dayLabel);
  if (Number.isNaN(parsed.getTime())) return dayLabel;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function BookingClient({
  title,
  durationMinutes,
  availability,
}: Props) {
  const [selectedSlot, setSelectedSlot] = useState<{
    dayLabel: string;
    slotIso: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    if (!selectedSlot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) setSelectedSlot(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSlot, isSubmitting]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSlot || isSubmitting) return;
    const formData = new FormData(e.currentTarget);
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await createBookingAction(selectedSlot.slotIso, formData);
      if (result.ok) {
        setSelectedSlot(null);
        setConfirmation({
          dayLabel: selectedSlot.dayLabel,
          slotIso: selectedSlot.slotIso,
        });
      } else {
        setErrorMsg(result.error);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isSubmitting) {
      setSelectedSlot(null);
      setErrorMsg(null);
    }
  };

  if (confirmation) {
    return (
      <div className="mt-6 flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.414 0l-3.5-3.5a1 1 0 111.414-1.42L8.5 12.086l6.79-6.796a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div>
          <p className="text-lg font-semibold">You&apos;re booked!</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {formatDayHeading(confirmation.dayLabel)} at{" "}
            {formatTime(confirmation.slotIso)} ({durationMinutes} min) with{" "}
            {title}.
          </p>
        </div>
      </div>
    );
  }

  const hasAnySlots = availability.some((d) => d.slots.length > 0);

  return (
    <>
      <div className="mt-6 space-y-6">
        {!hasAnySlots && (
          <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            No open times in the next two weeks.
          </p>
        )}
        {availability.map((day) =>
          day.slots.length === 0 ? null : (
            <div key={day.dayLabel}>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {formatDayHeading(day.dayLabel)}
              </h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {day.slots.map((iso) => (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setSelectedSlot({ dayLabel: day.dayLabel, slotIso: iso });
                    }}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:border-indigo-300 hover:bg-indigo-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-950/40"
                  >
                    {formatTime(iso)}
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
      </div>

      {selectedSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onBackdropClick}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                {formatTime(selectedSlot.slotIso)} ·{" "}
                {formatDayHeading(selectedSlot.dayLabel)}
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmitting) {
                    setSelectedSlot(null);
                    setErrorMsg(null);
                  }
                }}
                aria-label="close"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {durationMinutes} min · with {title}
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-4 flex flex-col gap-4"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-500">Your name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-500">
                  Email <span className="text-zinc-400">(optional)</span>
                </span>
                <input
                  type="email"
                  name="email"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-zinc-500">
                  Notes <span className="text-zinc-400">(optional)</span>
                </span>
                <textarea
                  name="notes"
                  rows={3}
                  className={inputClass}
                />
              </label>

              {errorMsg && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {errorMsg}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!isSubmitting) {
                      setSelectedSlot(null);
                      setErrorMsg(null);
                    }
                  }}
                  disabled={isSubmitting}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  {isSubmitting ? "Booking…" : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
