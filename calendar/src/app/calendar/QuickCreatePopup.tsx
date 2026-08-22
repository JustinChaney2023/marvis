"use client";

import { useState } from "react";
import { formatTime } from "@/lib/calendar-dates";
import { createQuickEventAction, createQuickTaskAction } from "../actions";
import type { EventModalEvent } from "./EventModal";
import Button from "../ui/Button";

type Props = {
  start: Date;
  end: Date;
  onClose: () => void;
  // Events get handed straight to the full editor afterward (cheap —
  // EventModal's already loaded here) so there's an easy path to "add
  // more detail" without a second click. Tasks just close — no
  // equivalent full editor lives on the calendar page, and the task is
  // just as easy to flesh out later from the Tasks page.
  onCreatedEvent: (event: EventModalEvent) => void;
};

export default function QuickCreatePopup({ start, end, onClose, onCreatedEvent }: Props) {
  const [kind, setKind] = useState<"event" | "task">("event");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (kind === "event") {
        const id = await createQuickEventAction(trimmed, start.toISOString(), end.toISOString());
        if (!id) return;
        onCreatedEvent({
          id,
          title: trimmed,
          notes: null,
          start,
          end,
          recurrenceRule: null,
          locked: true,
          meetingUrl: null,
          color: null,
          eventType: "DEFAULT",
          allDay: false,
          reminderMinutes: 10,
          googleAccountId: null,
        });
      } else {
        await createQuickTaskAction(trimmed, start.toISOString(), end.toISOString());
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xs rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800"
      >
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatTime(start)} – {formatTime(end)}
        </p>

        <div className="mt-2 inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900/40">
          {(["event", "task"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={
                kind === k
                  ? "rounded-md bg-white px-3 py-1 text-xs font-medium capitalize text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "rounded-md px-3 py-1 text-xs capitalize text-zinc-500 dark:text-zinc-400"
              }
            >
              {k}
            </button>
          ))}
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "event" ? "Event name" : "Task name"}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
        />
        <p className="mt-1 text-[11px] text-zinc-400">
          Placed here and locked — drag it again if it needs moving, or unlock it later to let
          auto-scheduling manage it.
        </p>

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" pending={isSubmitting} disabled={!title.trim()}>
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}
