"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export default function TimerClient({
  title,
  totalSeconds,
  initialSecondsLeft,
}: {
  title: string;
  totalSeconds: number;
  initialSecondsLeft: number;
}) {
  const [secondsLeft, setSecondsLeft] = useState(initialSecondsLeft);
  const [running, setRunning] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef(Date.now() + initialSecondsLeft * 1000);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    // Anchor to a wall-clock end time and recompute the remainder each tick,
    // rather than decrementing by 1 — setInterval drifts under tab
    // throttling/background tabs, an anchored diff doesn't.
    intervalRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setRunning(false);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const done = secondsLeft === 0;
  const progress = 1 - secondsLeft / totalSeconds;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-zinc-950 text-zinc-50">
      <Link
        href="/"
        className="absolute top-6 right-6 text-sm text-zinc-500 hover:text-zinc-300"
      >
        Exit
      </Link>

      <p className="text-lg text-zinc-400">{title}</p>

      <div className="relative flex h-80 w-80 items-center justify-center">
        <svg viewBox="0 0 100 100" className="absolute h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="45" fill="none" strokeWidth="4" className="text-zinc-800" stroke="currentColor" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className={done ? "text-emerald-500" : "text-indigo-400"}
            stroke="currentColor"
            strokeDasharray={2 * Math.PI * 45}
            strokeDashoffset={2 * Math.PI * 45 * (1 - progress)}
          />
        </svg>
        <span className="text-6xl font-bold tabular-nums">
          {done ? "Done" : formatClock(secondsLeft)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            if (!running) endAtRef.current = Date.now() + secondsLeft * 1000;
            setRunning((r) => !r);
          }}
          disabled={done}
          className="rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-all hover:bg-zinc-700 active:scale-[0.98] disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {running ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          onClick={() => {
            endAtRef.current = Date.now() + initialSecondsLeft * 1000;
            setSecondsLeft(initialSecondsLeft);
            setRunning(true);
          }}
          className="rounded-lg border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
