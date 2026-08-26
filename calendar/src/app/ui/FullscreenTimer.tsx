"use client";

import { useEffect, useRef, useState } from "react";
import Button from "./Button";

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

// Anchored to a wall-clock end time and recomputed each tick, rather than
// decrementing by 1 — setInterval drifts under tab throttling/background
// tabs, an anchored diff doesn't. Shared by Focus's per-task timer and
// the live-event fullscreen timer below.
export function useAnchoredCountdown(
  totalSeconds: number,
  initialSecondsLeft: number,
  autoStart = false,
) {
  const [secondsLeft, setSecondsLeft] = useState(initialSecondsLeft);
  const [running, setRunning] = useState(autoStart);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endAtRef = useRef(Date.now() + initialSecondsLeft * 1000);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setRunning(false);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const toggleRun = () => {
    if (!running) endAtRef.current = Date.now() + secondsLeft * 1000;
    setRunning((r) => !r);
  };
  const reset = () => {
    endAtRef.current = Date.now() + totalSeconds * 1000;
    setSecondsLeft(totalSeconds);
    setRunning(false);
  };
  const restart = (nextTotal: number) => {
    endAtRef.current = Date.now() + nextTotal * 1000;
    setSecondsLeft(nextTotal);
    setRunning(false);
  };

  return { secondsLeft, running, toggleRun, reset, restart };
}

// The immersive dark countdown — a live calendar event (the hidden
// mark-click / EventModal "Timer" link) and Focus's own "go fullscreen"
// both render this.
export function FullscreenTimer({
  title,
  totalSeconds,
  secondsLeft,
  running,
  onToggleRun,
  onReset,
  onExit,
}: {
  title: string;
  totalSeconds: number;
  secondsLeft: number;
  running: boolean;
  onToggleRun: () => void;
  onReset: () => void;
  onExit: () => void;
}) {
  const done = secondsLeft === 0;
  const progress = 1 - secondsLeft / totalSeconds;

  return (
    <div className="dark fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-paper text-ink">
      <button
        type="button"
        onClick={onExit}
        className="absolute top-6 right-6 font-mono text-[10px] uppercase tracking-wide text-muted hover:text-ink"
      >
        Exit
      </button>

      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{title}</p>

      <div className="relative flex h-80 w-80 items-center justify-center">
        <svg viewBox="0 0 100 100" className="absolute h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="45" fill="none" strokeWidth="4" className="text-rule-soft" stroke="currentColor" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className="text-accent"
            stroke="currentColor"
            strokeDasharray={2 * Math.PI * 45}
            strokeDashoffset={2 * Math.PI * 45 * (1 - progress)}
          />
        </svg>
        <span className="font-mono text-6xl font-bold tabular-nums">
          {done ? "Done" : formatClock(secondsLeft)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Button type="button" onClick={onToggleRun} disabled={done} className="px-6 py-3">
          {running ? "Pause" : "Resume"}
        </Button>
        <Button type="button" variant="outline" onClick={onReset} className="px-5 py-3">
          Reset
        </Button>
      </div>
    </div>
  );
}
