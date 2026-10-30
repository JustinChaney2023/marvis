"use client";

import { useEffect, useMemo, useState } from "react";
import { createBookingAction } from "../../actions";
import { CloseIcon } from "../../icons";
import Button from "../../ui/Button";

export type BookingDay = {
  dayLabel: string;
  slots: string[]; // ISO strings
};

type Props = {
  slug: string;
  title: string;
  durationMinutes: number;
  availability: BookingDay[];
};

type Confirmation = {
  dayLabel: string;
  slotIso: string;
};

const inputClass =
  "rounded-lg border border-rule bg-surface px-3 py-2 text-[13px] text-ink transition-colors focus:border-accent focus:outline-none";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// "YYYY-MM-DD" in the visitor's own zone. Parsed as a local date — `new
// Date("2026-11-05")` would be UTC midnight, i.e. the 4th west of UTC.
function formatDayHeading(dayLabel: string): string {
  const [y, m, d] = dayLabel.split("-").map(Number);
  const parsed = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(parsed.getTime())) return dayLabel;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BookingClient({
  slug,
  title,
  durationMinutes,
  availability: ownerDays,
}: Props) {
  // The server groups slots by the owner's day; a visitor elsewhere sees
  // times in their own zone, so regroup by *their* day to match.
  const availability = useMemo(() => {
    const byDay = new Map<string, string[]>();
    for (const iso of ownerDays.flatMap((d) => d.slots)) {
      const key = localDayKey(iso);
      byDay.set(key, [...(byDay.get(key) ?? []), iso]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayLabel, slots]) => ({ dayLabel, slots: slots.sort() }));
  }, [ownerDays]);
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
      const result = await createBookingAction(slug, selectedSlot.slotIso, formData);
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
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-wash text-accent">
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
          <p className="font-serif text-xl text-ink">You&apos;re booked!</p>
          <p className="mt-1 text-[13px] text-ink-2">
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
          <p className="rounded-lg border border-dashed border-rule py-6 text-center text-[13px] text-ink-2">
            No open times in the next two weeks.
          </p>
        )}
        {availability.map((day) =>
          day.slots.length === 0 ? null : (
            <div key={day.dayLabel}>
              <h2 className="font-serif text-lg text-ink">
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
                    className="rounded-lg border border-rule bg-surface px-3 py-1.5 font-mono text-[13px] text-ink-2 transition-all hover:border-accent hover:bg-accent-wash hover:text-ink active:scale-[0.98]"
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
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          onClick={onBackdropClick}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-panel w-full max-w-md rounded-2xl border border-rule bg-surface p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl text-ink">
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
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-rule-soft"
              >
                <CloseIcon />
              </button>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted">
              {durationMinutes} min · with {title}
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-4 flex flex-col gap-4"
            >
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-ink-2">Your name</span>
                <input
                  name="name"
                  required
                  autoFocus
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-ink-2">
                  Email <span className="text-muted">(optional)</span>
                </span>
                <input
                  type="email"
                  name="email"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px]">
                <span className="text-ink-2">
                  Notes <span className="text-muted">(optional)</span>
                </span>
                <textarea
                  name="notes"
                  rows={3}
                  className={inputClass}
                />
              </label>

              {errorMsg && (
                <p className="rounded-lg bg-accent-wash px-3 py-2 text-[13px] text-accent">
                  {errorMsg}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!isSubmitting) {
                      setSelectedSlot(null);
                      setErrorMsg(null);
                    }
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" pending={isSubmitting}>
                  {isSubmitting ? "Booking…" : "Confirm"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
