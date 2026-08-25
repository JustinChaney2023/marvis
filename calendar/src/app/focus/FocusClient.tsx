"use client";

import { useEffect, useRef, useState } from "react";
import { toggleTaskDone } from "../actions";
import { formatDueDateTime } from "@/lib/calendar-dates";

export type FocusTask = {
  id: string;
  title: string;
  durationMin: number;
  priority: number;
  energy: string;
  dueAt: Date | null;
  eventStart: Date | null;
};

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function FocusClient({ queue }: { queue: FocusTask[] }) {
  const [index, setIndex] = useState(0);
  const task = queue[index] ?? null;

  const [secondsLeft, setSecondsLeft] = useState(
    (task?.durationMin ?? 25) * 60,
  );
  const [running, setRunning] = useState(false);
  const [isMarkingDone, setIsMarkingDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset the timer when the active task changes — adjusted directly during
  // render (React's documented pattern for this) rather than in an effect,
  // which would cause an extra cascading render.
  const [trackedTaskId, setTrackedTaskId] = useState(task?.id);
  if (task?.id !== trackedTaskId) {
    setTrackedTaskId(task?.id);
    setSecondsLeft((task?.durationMin ?? 25) * 60);
    setRunning(false);
  }

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const handleMarkDone = async () => {
    if (!task || isMarkingDone) return;
    setIsMarkingDone(true);
    try {
      await toggleTaskDone(task.id, true);
      setIndex((i) => i + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setIsMarkingDone(false);
    }
  };

  const handleSkip = () => setIndex((i) => i + 1);

  if (!task) {
    return (
      <div className="mt-16 flex flex-col items-center gap-2 text-center">
        <p className="text-lg font-medium">Nothing left to focus on.</p>
        <p className="text-sm text-zinc-500">
          Add a task or schedule one to see it here.
        </p>
      </div>
    );
  }

  const totalSeconds = task.durationMin * 60;
  const progress = 1 - secondsLeft / totalSeconds;

  return (
    <div className="mt-10 flex flex-col items-center gap-8">
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {task.eventStart ? "Scheduled now" : "Up next"}
        </p>
        <h2 className="mt-2 text-xl font-semibold">{task.title}</h2>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-zinc-500">
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-700">
            {PRIORITY_LABEL[task.priority]}
          </span>
          {task.dueAt && <span>due {formatDueDateTime(task.dueAt)}</span>}
        </div>
      </div>

      <div className="relative flex h-48 w-48 items-center justify-center">
        <svg viewBox="0 0 100 100" className="absolute h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="6"
            className="text-zinc-200 dark:text-zinc-800"
            stroke="currentColor"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className="text-indigo-600 transition-[stroke-dashoffset] duration-500 dark:text-indigo-400"
            stroke="currentColor"
            strokeDasharray={2 * Math.PI * 45}
            strokeDashoffset={2 * Math.PI * 45 * (1 - progress)}
          />
        </svg>
        <span className="text-3xl font-bold tabular-nums">
          {formatClock(secondsLeft)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {running ? "Pause" : secondsLeft === totalSeconds ? "Start" : "Resume"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSecondsLeft(totalSeconds);
            setRunning(false);
          }}
          className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
        >
          Reset
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleMarkDone}
          disabled={isMarkingDone}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Mark done
        </button>
        <button
          type="button"
          onClick={handleSkip}
          className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Skip
        </button>
      </div>

      <p className="text-xs text-zinc-400">
        {index + 1} of {queue.length} in today&apos;s queue
      </p>
    </div>
  );
}
