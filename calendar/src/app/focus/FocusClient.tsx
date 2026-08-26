"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toggleTaskDone } from "../actions";
import { formatDueDateTime } from "@/lib/calendar-dates";
import Button from "../ui/Button";

export type FocusTask = {
  id: string;
  title: string;
  durationMin: number;
  priority: number;
  energy: string;
  dueAt: Date | null;
  eventStart: Date | null;
};

// A calendar event's live/upcoming session, resolved server-side from
// ?eventId= (see focus/page.tsx) — what the standalone /timer route used
// to hand to TimerClient. Not a FocusTask: it may not even be linked to
// one, so it gets its own fullscreen-only path with no mark-done/skip.
export type LiveEvent = {
  title: string;
  totalSeconds: number;
  initialSecondsLeft: number;
};

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];

function formatClock(totalSeconds: number): string {
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
// tabs, an anchored diff doesn't. Shared by the inline per-task timer and
// the fullscreen live-event view below (this used to be TimerClient-only;
// Focus's own per-task countdown just decremented naively).
function useAnchoredCountdown(totalSeconds: number, initialSecondsLeft: number) {
  const [secondsLeft, setSecondsLeft] = useState(initialSecondsLeft);
  const [running, setRunning] = useState(false);
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

// The immersive dark countdown — used both for a live calendar event
// (?eventId=) and for "go fullscreen" on whatever task is active below.
function FullscreenTimer({
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

// A live calendar event, e.g. a class already in progress, or the next one
// coming up — jumps straight to the fullscreen view, same as the old
// standalone /timer?eventId= route did. Exit drops the ?eventId= (plain
// <Link>, not local state) so it lands back on the normal task queue below
// instead of a state a page refresh could re-derive incorrectly.
function LiveEventTimer({ liveEvent }: { liveEvent: LiveEvent }) {
  const { secondsLeft, running, toggleRun, reset } = useAnchoredCountdown(
    liveEvent.totalSeconds,
    liveEvent.initialSecondsLeft,
  );
  const router = useRouter();

  return (
    <FullscreenTimer
      title={liveEvent.title}
      totalSeconds={liveEvent.totalSeconds}
      secondsLeft={secondsLeft}
      running={running}
      onToggleRun={toggleRun}
      onReset={reset}
      onExit={() => router.push("/focus")}
    />
  );
}

export default function FocusClient({
  queue,
  liveEvent,
}: {
  queue: FocusTask[];
  liveEvent?: LiveEvent | null;
}) {
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

  if (liveEvent) return <LiveEventTimer liveEvent={liveEvent} />;

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
        // The timer is also just a plain-utility "count down whatever
        // I'm doing right now" tool (it absorbed the old standalone
        // /timer route) — it shouldn't be gated behind having a task
        // queued, the same way EventModal's "Timer" link on a live
        // event works with no task involved at all.
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
