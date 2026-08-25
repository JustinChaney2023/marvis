"use client";

import { useEffect, useRef, useState } from "react";
import { quickCaptureTask, quickCaptureEvent } from "./actions";
import Button from "./ui/Button";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

export default function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"task" | "event">("task");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (e.key === "c" && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!value.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await (mode === "task" ? quickCaptureTask(value) : quickCaptureEvent(value));
      setValue("");
      setOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[20vh] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Quick add task"
    >
      <div className="modal-panel w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-zinc-100 p-1 text-xs dark:bg-zinc-700">
          {(["task", "event"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? "rounded-full bg-white px-3 py-1 font-medium text-zinc-900 dark:bg-zinc-600 dark:text-zinc-50"
                  : "rounded-full px-3 py-1 text-zinc-500 dark:text-zinc-400"
              }
            >
              {m === "task" ? "Task" : "Event"}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              mode === "task" ? "Call dentist tomorrow 3pm p2" : "Lunch with Sam tomorrow 1pm for 1h"
            }
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          <Button type="submit" pending={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">
          Try “today / tomorrow / next friday / in 3 days”, a time like “3pm”,
          {mode === "event" && " a duration like “for 1h”,"} and “p0”–“p3”
          for priority{mode === "task" ? "" : " (ignored for events)"}. Press{" "}
          <kbd>c</kbd> anywhere to open this, Esc to close.
        </p>
      </div>
    </div>
  );
}
