"use client";

import { useState } from "react";
import { toggleTaskDone } from "../actions";
import { formatDueDateTime } from "@/lib/calendar-dates";
import Button from "../ui/Button";
import { FullscreenTimer, useAnchoredCountdown, formatClock } from "../ui/FullscreenTimer";

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

export default function FocusClient({ queue }: { queue: FocusTask[] }) {
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const task = queue[index] ?? null;
  const totalSeconds = (task?.durationMin ?? 25) * 60;

  const { secondsLeft, running, toggleRun, reset, restart } = useAnchoredCountdown(totalSeconds, totalSeconds);

  // Reset the timer when the active task changes — adjusted directly during
  // render (React's documented pattern for this) rather than in an effect,
  // which would cause an extra cascading render.
  const [trackedTaskId, setTrackedTaskId] = useState(task?.id);
  if (task?.id !== trackedTaskId) {
    setTrackedTaskId(task?.id);
    setFullscreen(false);
    restart((task?.durationMin ?? 25) * 60);
  }

  const [isMarkingDone, setIsMarkingDone] = useState(false);

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

  if (fullscreen) {
    return (
      <FullscreenTimer
        title={task?.title ?? "Timer"}
        totalSeconds={totalSeconds}
        secondsLeft={secondsLeft}
        running={running}
        onToggleRun={toggleRun}
        onReset={reset}
        onExit={() => setFullscreen(false)}
      />
    );
  }

  const progress = 1 - secondsLeft / totalSeconds;

  return (
    <div className="mt-10 flex flex-col items-center gap-8">
      {task ? (
        <div className="w-full rounded-2xl border border-rule bg-surface p-6 text-center">
          <p className="font-mono text-[10px] font-medium uppercase tracking-wide text-muted">
            {task.eventStart ? "Scheduled now" : "Up next"}
          </p>
          <h2 className="mt-2 font-serif text-2xl text-ink">{task.title}</h2>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink-2">
            <span className="inline-flex items-center rounded-full border border-rule px-2 py-0.5 font-mono">
              {PRIORITY_LABEL[task.priority]}
            </span>
            {task.dueAt && <span>due {formatDueDateTime(task.dueAt)}</span>}
          </div>
        </div>
      ) : (
        // Also a plain pomodoro timer, not gated behind having a task
        // queued — a task worker with nothing left to work through
        // shouldn't lose the timer along with it.
        <div className="w-full rounded-2xl border border-dashed border-rule p-6 text-center">
          <p className="font-serif text-xl text-ink">Nothing left to focus on.</p>
          <p className="mt-1 text-sm text-muted">Add a task, or just start the timer.</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setFullscreen(true)}
        title="Go fullscreen"
        className="relative flex h-48 w-48 items-center justify-center"
      >
        <svg viewBox="0 0 100 100" className="absolute h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="6"
            className="text-rule-soft"
            stroke="currentColor"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className="text-accent transition-[stroke-dashoffset] duration-500"
            stroke="currentColor"
            strokeDasharray={2 * Math.PI * 45}
            strokeDashoffset={2 * Math.PI * 45 * (1 - progress)}
          />
        </svg>
        <span className="font-mono text-3xl font-bold tabular-nums text-ink">
          {formatClock(secondsLeft)}
        </span>
      </button>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={toggleRun}>
          {running ? "Pause" : secondsLeft === totalSeconds ? "Start" : "Resume"}
        </Button>
        <Button type="button" variant="outline" onClick={reset}>
          Reset
        </Button>
      </div>

      {task && (
        <>
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={handleMarkDone} pending={isMarkingDone}>
              Mark done
            </Button>
            <Button type="button" variant="ghost" onClick={handleSkip}>
              Skip
            </Button>
          </div>

          <p className="font-mono text-xs text-muted">
            {index + 1} of {queue.length} in today&apos;s queue
          </p>
        </>
      )}
    </div>
  );
}
