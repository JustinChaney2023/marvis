"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { quickCaptureTask, quickCaptureEvent, listProjectNamesAction } from "./actions";
import { parseQuickCapture } from "@/lib/quickCapture";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";
import { QUICK_CAPTURE_EVENT, type QuickCaptureMode } from "./quickCaptureEvents";
import { CloseIcon } from "./icons";
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

export type CaptureProject = { id: string; name: string; color: string };
type Project = CaptureProject;

const PRIORITY_LABELS = ["", "Medium", "High", "Urgent"];
const SCHEDULE_PREF_KEY = "quickCapture.autoSchedule";

function formatWhen(d: Date, hasTime: boolean): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - startOfToday) / 86_400_000);
  const day =
    dayDiff === 0
      ? "Today"
      : dayDiff === 1
        ? "Tomorrow"
        : dayDiff > 1 && dayDiff < 7
          ? d.toLocaleDateString(undefined, { weekday: "long" })
          : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return hasTime ? `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : day;
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function matchProject(projects: Project[], name: string): Project | null {
  const needle = name.toLowerCase();
  return (
    projects.find((p) => p.name.toLowerCase() === needle) ??
    projects.find((p) => p.name.toLowerCase().startsWith(needle)) ??
    projects.find((p) => p.name.toLowerCase().includes(needle)) ??
    null
  );
}

/**
 * The one global "add something" box — "c" on a keyboard, the "+" tab on
 * a phone, or the rail's Quick add button. Shows what it understood as
 * you type (date, priority, length, project) so the shorthand is
 * discoverable instead of something you have to remember, and stays open
 * after each add so a brain-dump of several tasks is just type, Enter,
 * type, Enter.
 */
export default function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<QuickCaptureMode>("task");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Read lazily — the box renders nothing until opened, so there's no
  // server-rendered checkbox for this to mismatch on hydration.
  const [autoSchedule, setAutoSchedule] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(SCHEDULE_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [added, setAdded] = useState<{ text: string; warning?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (e.key === "c" && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<QuickCaptureMode>).detail;
      if (detail) setMode(detail);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(QUICK_CAPTURE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(QUICK_CAPTURE_EVENT, onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    listProjectNamesAction()
      .then(setProjects)
      .catch(() => {});
  }, [open]);

  const close = () => {
    setOpen(false);
    setAdded([]);
    setError(null);
  };

  // "#bi" being typed at the end of the input -> suggest matching projects.
  const hashQuery = value.match(/(?:^|\s)#([\p{L}\p{N}_-]*)$/u)?.[1];
  const suggestions =
    hashQuery !== undefined && mode === "task"
      ? projects
          .filter((p) => p.name.toLowerCase().replace(/\s+/g, "-").includes(hashQuery.toLowerCase()))
          .slice(0, 5)
      : [];
  const completeProject = (p: Project) => {
    setValue((v) => v.replace(/#[\p{L}\p{N}_-]*$/u, `#${p.name.replace(/\s+/g, "-")} `));
    inputRef.current?.focus();
  };

  const toggleAutoSchedule = () => {
    setAutoSchedule((s) => {
      try {
        localStorage.setItem(SCHEDULE_PREF_KEY, s ? "0" : "1");
      } catch {}
      return !s;
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!value.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result =
        mode === "task" ? await quickCaptureTask(value, { schedule: autoSchedule }) : await quickCaptureEvent(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const parts = [result.title];
      if (result.projectName) parts.push(`in ${result.projectName}`);
      if (result.scheduledFor) {
        const when = new Date(result.scheduledFor);
        parts.push(`${mode === "task" ? "scheduled " : ""}${formatWhen(when, true)}`);
      } else if (mode === "task" && autoSchedule) {
        parts.push("no free slot found");
      }
      setAdded((a) => [
        {
          text: parts.join(" · "),
          warning: result.unmatchedProject ? `No project called “${result.unmatchedProject}”` : undefined,
        },
        ...a.slice(0, 4),
      ]);
      setValue("");
    } catch (err) {
      console.error(err);
      setError("Couldn't add that — try again.");
    } finally {
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-scrim p-3 pt-[10vh] md:p-4 md:pt-[18vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Quick add"
    >
      <div className="modal-panel w-full max-w-lg rounded-2xl border border-rule bg-surface p-4 shadow-xl shadow-black/10">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 rounded-full border border-rule bg-paper p-1 text-xs">
            {(["task", "event"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  inputRef.current?.focus();
                }}
                className={
                  mode === m
                    ? "rounded-full bg-ink px-3 py-1 font-medium text-paper"
                    : "rounded-full px-3 py-1 text-ink-2"
                }
              >
                {m === "task" ? "Task" : "Event"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-rule-soft hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="relative flex items-center gap-2">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab" && suggestions.length > 0) {
                  e.preventDefault();
                  completeProject(suggestions[0]);
                }
              }}
              enterKeyHint="done"
              autoComplete="off"
              placeholder={mode === "task" ? "Read chapter 4 friday #bio 1h" : "Lunch with Sam tomorrow 1pm 1h"}
              className="min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 py-2.5 text-base text-ink transition-colors focus:border-accent focus:outline-none md:text-sm"
            />
            <Button type="submit" pending={isSubmitting}>
              Add
            </Button>
            {suggestions.length > 0 && (
              <ul className="absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden rounded-lg border border-rule bg-surface py-1 text-sm shadow-lg shadow-black/10">
                {suggestions.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => completeProject(p)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-rule-soft ${i === 0 ? "bg-rule-soft/60" : ""}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${PROJECT_EVENT_COLORS[p.color]?.dot ?? "bg-muted"}`} />
                      {p.name}
                      {i === 0 && <kbd className="ml-auto font-mono text-[10px] text-muted">tab</kbd>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <CapturePreview
            value={value}
            mode={mode}
            projects={projects}
            typingProject={hashQuery !== undefined}
            className="mt-2"
          />
        </form>

        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {added.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 border-t border-rule pt-3 text-xs">
            {added.map((a, i) => (
              <li key={`${a.text}-${i}`} className={i === 0 ? "text-ink-2" : "text-muted"}>
                <span className="text-accent">✓</span> {a.text}
                {a.warning && <span className="ml-1 text-amber-700 dark:text-amber-400">({a.warning})</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3 text-xs text-muted">
          {mode === "task" ? (
            <label className="flex cursor-pointer items-center gap-2 text-ink-2">
              <input type="checkbox" checked={autoSchedule} onChange={toggleAutoSchedule} className="accent-[var(--accent)]" />
              Find time on my calendar
            </label>
          ) : (
            <span>Overlapping task blocks get moved.</span>
          )}
          <span className="flex items-center gap-3">
            {mode === "task" && (
              <Link href="/tasks?new=1" onClick={close} className="text-accent hover:underline">
                Full form
              </Link>
            )}
            <span className="hidden md:inline">
              <kbd>Enter</kbd> add · <kbd>Esc</kbd> close
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * "Here's what I understood" chips under a quick-add input — shared by
 * the global QuickCapture box and the Tasks page's inline add bar.
 */
export function CapturePreview({
  value,
  mode,
  projects,
  typingProject = false,
  fallbackProject,
  className = "",
}: {
  value: string;
  mode: QuickCaptureMode;
  projects: Project[];
  typingProject?: boolean;
  fallbackProject?: Project | null;
  className?: string;
}) {
  const parsed = useMemo(
    () => (value.trim() ? parseQuickCapture(value, new Date(), undefined, mode === "task" ? 17 : 9) : null),
    [value, mode],
  );
  const matchedProject = parsed?.projectName ? matchProject(projects, parsed.projectName) : null;

  const chips: { label: string; className?: string }[] = [];
  if (parsed) {
    if (parsed.dueAt) chips.push({ label: `${mode === "task" ? "Due " : ""}${formatWhen(parsed.dueAt, parsed.hasTime)}` });
    if (mode === "task" && parsed.priority > 0) {
      chips.push({ label: PRIORITY_LABELS[parsed.priority], className: parsed.priority === 3 ? "text-red-600 dark:text-red-400" : undefined });
    }
    if (parsed.durationMin) chips.push({ label: formatDuration(parsed.durationMin) });
    else if (mode === "event") chips.push({ label: "30 min" });
    if (mode === "task" && parsed.projectName && !typingProject) {
      chips.push(
        matchedProject
          ? { label: matchedProject.name, className: PROJECT_EVENT_COLORS[matchedProject.color]?.badge }
          : { label: `#${parsed.projectName}?`, className: "text-amber-700 dark:text-amber-400" },
      );
    } else if (mode === "task" && fallbackProject && !parsed.projectName) {
      chips.push({ label: fallbackProject.name, className: PROJECT_EVENT_COLORS[fallbackProject.color]?.badge });
    }
  }

  return (
    <div className={`flex min-h-7 flex-wrap items-center gap-1.5 text-xs ${className}`}>
      {parsed?.title && chips.length > 0 ? (
        <>
          <span className="mr-0.5 max-w-[12rem] truncate font-medium text-ink">{parsed.title}</span>
          {chips.map((c) => (
            <span key={c.label} className={`rounded-full border border-rule bg-paper px-2 py-0.5 text-ink-2 ${c.className ?? ""}`}>
              {c.label}
            </span>
          ))}
        </>
      ) : (
        <span className="text-muted">
          {mode === "task"
            ? "Add a day (fri, tomorrow, nov 3), time (3pm), length (1h), #project, or ! for priority."
            : "Add a day (fri, tomorrow, nov 3), a time (3pm), and a length (1h)."}
        </span>
      )}
    </div>
  );
}
