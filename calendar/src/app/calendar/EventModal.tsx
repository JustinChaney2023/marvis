"use client";

import { useEffect, useRef, useState } from "react";
import { createEvent, deleteEvent, updateEvent } from "../actions";
import { toLocalInputValue } from "@/lib/calendar-dates";
import { RECURRENCE_PRESETS } from "@/lib/recurrence";

export type EventModalEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  recurrenceRule: string | null;
  locked: boolean;
};

type Props = {
  mode: "create" | "edit";
  initialStart: Date;
  initialEnd: Date;
  event: EventModalEvent | null;
  onClose: () => void;
};

export default function EventModal({
  mode,
  initialStart,
  initialEnd,
  event,
  onClose,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    const formData = new FormData(e.currentTarget);
    setIsSubmitting(true);
    try {
      if (mode === "create") {
        await createEvent(formData);
      } else if (event) {
        await updateEvent(event.id, formData);
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!event || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await deleteEvent(event.id);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const initialTitle = mode === "edit" && event ? event.title : "";
  const startValue = toLocalInputValue(
    mode === "edit" && event ? event.start : initialStart,
  );
  const endValue = toLocalInputValue(
    mode === "edit" && event ? event.end : initialEnd,
  );
  const initialRecurrenceRule =
    mode === "edit" && event && event.recurrenceRule
      ? event.recurrenceRule
      : "";
  const isEditingRecurring = mode === "edit" && !!event?.recurrenceRule;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {mode === "create" ? "New event" : "Edit event"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Title</span>
            <input
              ref={titleInputRef}
              name="title"
              required
              defaultValue={initialTitle}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Start</span>
            <input
              type="datetime-local"
              name="start"
              required
              defaultValue={startValue}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">End</span>
            <input
              type="datetime-local"
              name="end"
              required
              defaultValue={endValue}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Repeat</span>
            <select
              name="recurrenceRule"
              defaultValue={initialRecurrenceRule}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            >
              {RECURRENCE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            {isEditingRecurring && (
              <span className="text-xs text-zinc-500">
                Editing the whole series.
              </span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="locked"
              defaultChecked={mode === "edit" && !!event?.locked}
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <span>Locked (won&apos;t be moved by auto-scheduling or drag)</span>
          </label>

          <div className="mt-2 flex items-center justify-between gap-2">
            {mode === "edit" ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isSubmitting}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
                {isEditingRecurring && (
                  <span className="text-xs text-zinc-500">
                    Deletes the whole series.
                  </span>
                )}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                {isSubmitting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
