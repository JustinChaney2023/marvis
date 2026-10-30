"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toggleTaskDone, startTaskFocus, extendTaskFocus, endTaskFocus } from "../actions";
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
const ADD_TIME_PRESETS_MIN = [5, 10, 15];

type PomodoroPhase = "work" | "break" | "longBreak";

function phaseSecondsFor(phase: PomodoroPhase, workMin: number, breakMin: number, longBreakMin: number): number {
  return (phase === "work" ? workMin : phase === "break" ? breakMin : longBreakMin) * 60;
}

function phaseLabel(phase: PomodoroPhase): string {
  return phase === "work" ? "Focus" : phase === "break" ? "Break" : "Long break";
}

function notifyPhaseChange(phase: PomodoroPhase) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const body =
    phase === "work" ? "Back to it." : phase === "break" ? "Step away for a few minutes." : "Take a longer break.";
  new Notification(phaseLabel(phase), { body });
}

// A standalone anchored cycle of work/break/long-break phases — kept
// separate from useAnchoredCountdown above (that hook always pauses on
// restart(), which is right for a single countdown but wrong here: a
// phase boundary has to keep running straight into the next phase).
function usePomodoro(workMin: number, breakMin: number, longBreakMin: number) {
  const [phase, setPhase] = useState<PomodoroPhase>("work");
  const [cycles, setCycles] = useState(0);
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => phaseSecondsFor("work", workMin, breakMin, longBreakMin));
  // Only ever read once toggleRun (or the phase-boundary tick) has set it
  // for real — running starts false, so this placeholder is never used.
  const endAtRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        setPhase((prev) => {
          const nextCycles = prev === "work" ? cycles + 1 : cycles;
          const next: PomodoroPhase = prev === "work" ? (nextCycles % 4 === 0 ? "longBreak" : "break") : "work";
          setCycles(nextCycles);
          const nextSeconds = phaseSecondsFor(next, workMin, breakMin, longBreakMin);
          endAtRef.current = Date.now() + nextSeconds * 1000;
          setSecondsLeft(nextSeconds);
          notifyPhaseChange(next);
          return next;
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, cycles, workMin, breakMin, longBreakMin]);

  const toggleRun = () => {
    if (!running) endAtRef.current = Date.now() + secondsLeft * 1000;
    setRunning((r) => !r);
  };
  const reset = () => {
    const seconds = phaseSecondsFor("work", workMin, breakMin, longBreakMin);
    setPhase("work");
    setCycles(0);
    setSecondsLeft(seconds);
    endAtRef.current = Date.now() + seconds * 1000;
    setRunning(false);
  };

  return {
    phase,
    cycles,
    running,
    secondsLeft,
    totalSeconds: phaseSecondsFor(phase, workMin, breakMin, longBreakMin),
    toggleRun,
    reset,
  };
}

export default function FocusClient({
  queue,
  initialTaskId = null,
  solo = false,
}: {
  queue: FocusTask[];
  initialTaskId?: string | null;
  solo?: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(() => {
    if (!initialTaskId) return 0;
    const i = queue.findIndex((t) => t.id === initialTaskId);
    return i >= 0 ? i : 0;
  });
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

  // Solo mode: a real calendar event backs this session — its start is
  // when the session was started, its end is whenever it's ended (or
  // extended along the way). Started once per mount; startTaskFocus is
  // idempotent against an already-ONGOING task, so a double-fire (e.g.
  // React StrictMode) just resumes the same event instead of duplicating it.
  const [session, setSession] = useState<{ eventId: string; startedAt: number } | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isEndingFocus, setIsEndingFocus] = useState(false);
  const startedOnceRef = useRef(false);

  useEffect(() => {
    if (!solo || !task || startedOnceRef.current) return;
    startedOnceRef.current = true;
    startTaskFocus(task.id)
      .then((res) => setSession({ eventId: res.eventId, startedAt: new Date(res.startIso).getTime() }))
      .catch((err) => console.error(err));
  }, [solo, task]);

  useEffect(() => {
    if (!session) return;
    const tick = () => setElapsedSec(Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  const handleEndFocus = async () => {
    if (!session || isEndingFocus) return;
    setIsEndingFocus(true);
    try {
      await endTaskFocus(session.eventId);
      router.push("/tasks");
    } catch (err) {
      console.error(err);
    } finally {
      setIsEndingFocus(false);
    }
  };

  const handleAddTime = async (minutes: number) => {
    if (!session) return;
    await extendTaskFocus(session.eventId, minutes);
  };

  const handleMarkDone = async () => {
    if (!task || isMarkingDone) return;
    setIsMarkingDone(true);
    try {
      if (session) await endTaskFocus(session.eventId);
      await toggleTaskDone(task.id, true);
      if (solo) {
        router.push("/tasks");
      } else {
        setIndex((i) => i + 1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsMarkingDone(false);
    }
  };

  const handleSkip = () => setIndex((i) => i + 1);

  // Pomodoro: an alternative pacing mode for the same session — cycles
  // work/break/long-break instead of one straight countdown. Independent
  // of the solo focus session above (which tracks the real calendar
  // block); this only paces the on-screen clock.
  const [pomodoro, setPomodoro] = useState(false);
  const [workMin, setWorkMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const [longBreakMin, setLongBreakMin] = useState(15);
  const pomo = usePomodoro(workMin, breakMin, longBreakMin);

  const activeTotalSeconds = pomodoro ? pomo.totalSeconds : totalSeconds;
  const activeSecondsLeft = pomodoro ? pomo.secondsLeft : secondsLeft;
  const activeRunning = pomodoro ? pomo.running : running;
  const activeToggleRun = pomodoro ? pomo.toggleRun : toggleRun;
  const activeReset = pomodoro ? pomo.reset : reset;
  const activeTitle = pomodoro ? phaseLabel(pomo.phase) : (task?.title ?? "Timer");

  if (fullscreen) {
    return (
      <FullscreenTimer
        title={activeTitle}
        totalSeconds={activeTotalSeconds}
        secondsLeft={activeSecondsLeft}
        running={activeRunning}
        onToggleRun={activeToggleRun}
        onReset={activeReset}
        onExit={() => setFullscreen(false)}
      />
    );
  }

  const progress = 1 - activeSecondsLeft / activeTotalSeconds;

  return (
    <div className="mt-10 flex flex-col items-center gap-8">
      {task ? (
        <div className="w-full rounded-2xl border border-rule bg-surface p-6 text-center">
          <p className="font-mono text-[10px] font-medium uppercase tracking-wide text-muted">
            {solo ? "Solo focus" : task.eventStart ? "Scheduled now" : "Up next"}
          </p>
          <h2 className="mt-2 font-serif text-2xl text-ink">{task.title}</h2>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink-2">
            <span className="inline-flex items-center rounded-full border border-rule px-2 py-0.5 font-mono">
              {PRIORITY_LABEL[task.priority]}
            </span>
            {task.dueAt && <span>due {formatDueDateTime(task.dueAt)}</span>}
          </div>
          {session && (
            <p className="mt-2 font-mono text-xs text-muted">
              Session running · {formatClock(elapsedSec)} elapsed
            </p>
          )}
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

      <label className="flex items-center gap-2 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={pomodoro}
          onChange={(e) => {
            setPomodoro(e.target.checked);
            pomo.reset();
          }}
        />
        Pomodoro
      </label>

      {pomodoro && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-ink-2">
          <label className="flex items-center gap-1">
            Work
            <input
              type="number"
              min={1}
              value={workMin}
              onChange={(e) => setWorkMin(Math.max(1, Number(e.target.value) || 1))}
              className="w-12 rounded-md border border-rule bg-paper px-1 py-0.5 text-center"
            />
            min
          </label>
          <label className="flex items-center gap-1">
            Break
            <input
              type="number"
              min={1}
              value={breakMin}
              onChange={(e) => setBreakMin(Math.max(1, Number(e.target.value) || 1))}
              className="w-12 rounded-md border border-rule bg-paper px-1 py-0.5 text-center"
            />
            min
          </label>
          <label className="flex items-center gap-1">
            Long break
            <input
              type="number"
              min={1}
              value={longBreakMin}
              onChange={(e) => setLongBreakMin(Math.max(1, Number(e.target.value) || 1))}
              className="w-12 rounded-md border border-rule bg-paper px-1 py-0.5 text-center"
            />
            min
          </label>
          <span>every 4th cycle · {pomo.cycles} done</span>
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
          {pomodoro ? phaseLabel(pomo.phase) : formatClock(activeSecondsLeft)}
        </span>
      </button>
      {pomodoro && (
        <p className="-mt-6 font-mono text-lg font-bold tabular-nums text-ink">{formatClock(activeSecondsLeft)}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={activeToggleRun}>
          {activeRunning ? "Pause" : activeSecondsLeft === activeTotalSeconds ? "Start" : "Resume"}
        </Button>
        <Button type="button" variant="outline" onClick={activeReset}>
          Reset
        </Button>
      </div>

      {solo && session && (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Add time:</span>
            {ADD_TIME_PRESETS_MIN.map((m) => (
              <Button key={m} type="button" variant="ghost" onClick={() => handleAddTime(m)}>
                +{m}m
              </Button>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={handleEndFocus} pending={isEndingFocus}>
            End focus
          </Button>
        </div>
      )}

      {task && (
        <>
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={handleMarkDone} pending={isMarkingDone}>
              Mark done
            </Button>
            {!solo && (
              <Button type="button" variant="ghost" onClick={handleSkip}>
                Skip
              </Button>
            )}
          </div>

          {!solo && (
            <p className="font-mono text-xs text-muted">
              {index + 1} of {queue.length} in today&apos;s queue
            </p>
          )}
        </>
      )}
    </div>
  );
}
