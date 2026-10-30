"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  toggleTaskDone,
  scheduleTaskAction,
  unscheduleTaskAction,
  createSubtaskAction,
  createSubtasksBulkAction,
  generateSubtasksAction,
  draftTaskEmailAction,
  draftTaskDocAction,
  deleteTaskAction,
  setTaskStatusAction,
  delayTaskAction,
} from "../actions";
import { ConfirmForm } from "../ui/ConfirmForm";
import { PersonIcon, RobotIcon, RepeatIcon, AlertTriangleIcon, ChevronRightIcon, CloseIcon, SparkleIcon } from "../icons";
import { formatDueDateTime } from "@/lib/calendar-dates";
import TaskModal, { type TaskModalTask } from "./TaskModal";
import { STATUS_BADGE, STATUS_LABEL, type TaskStatus } from "./taskStatus";
import { PROJECT_EVENT_COLORS, isCustomColor, customColorStyle } from "@/lib/eventColors";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };
type TimeSlot = { id: string; name: string };
type Label = { id: string; name: string; color: string };
type TaskOption = { id: string; title: string };

type Subtask = { id: string; title: string; status: TaskStatus };

export type TaskRowData = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: number;
  durationMin: number;
  trackedMinutes: number;
  timerStartedAt: Date | null;
  startAt: Date | null;
  dueAt: Date | null;
  recurrenceRule: string | null;
  projectId: string | null;
  assigneeId: string | null;
  timeSlotId: string | null;
  color: string | null;
  hardDeadline: boolean;
  chunkMin: number | null;
  project: { name: string; color: string } | null;
  assignee: { name: string; type: "HUMAN" | "AI" } | null;
  // The earliest chunk, for a chunked task — see withPrimaryEvent in
  // tasks/page.tsx. eventCount > 1 means it's split into that many.
  event: { start: Date; locked: boolean } | null;
  eventCount: number;
  subtasks: Subtask[];
  labels: Label[];
  blockedBy: { id: string; title: string; status: TaskStatus }[];
};

// AI subtask suggestions and email/doc drafts used to live only in this
// component's React state, so navigating away (or the page just
// re-rendering) silently discarded them — after a ~30s generation, that
// reads as "the app lost my work." Session-scoped, not persisted forever:
// this is scratch output the user still needs to explicitly Add/Copy or
// Discard, not a saved record.
function subscribeNever() {
  return () => {};
}

function readPersisted<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function usePersistedState<T>(key: string, initial: T | null) {
  const [value, setValue] = useState<T | null>(() => readPersisted<T>(key) ?? initial);
  useEffect(() => {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // best-effort — a full/unavailable sessionStorage shouldn't break the feature
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];
// Neutral for Low/Medium/High — the one accent color is reserved for the
// due/overdue/primary-action states elsewhere in this file, so only
// Urgent (effectively "treat like an error") borrows it.
const PRIORITY_BADGE: Record<number, string> = {
  0: "bg-rule-soft text-ink-2",
  1: "bg-rule-soft text-ink-2",
  2: "bg-rule-soft text-ink-2",
  3: "bg-accent-wash text-accent",
};
// Project/label swatches are a categorical legend (users pick from this
// same palette across Projects/Gantt/Tasks) — sourced from the one
// shared palette in @/lib/eventColors instead of a second hand-copy of it.
const PROJECT_COLOR_BADGE: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_EVENT_COLORS).map(([color, c]) => [color, c.badge]),
);

export default function TaskRow({
  task,
  projects,
  assignees,
  timeSlots,
  labels,
  otherTasks,
  defaultProjectId,
  blockingTitles = [],
  onDragStart,
  pending = false,
}: {
  task: TaskRowData;
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
  labels: Label[];
  otherTasks: TaskOption[];
  defaultProjectId: string;
  // Titles of other open tasks that list this one as a blocker — deleting
  // this task silently drops those tasks' "Blocked" state, so the delete
  // confirmation says so instead of just vanishing it.
  blockingTitles?: string[];
  // Set only by TaskBoard — makes the card HTML5-draggable between
  // Kanban columns. Omitted (undefined) everywhere else, so List/Table
  // rows aren't draggable with nowhere to drop them.
  onDragStart?: (e: React.DragEvent) => void;
  // TaskBoard dims a card while its cross-column move is in flight.
  pending?: boolean;
}) {
  // Deep-link from the calendar's "Upcoming" list — `/tasks?edit=<id>`
  // opens this task's own edit modal immediately instead of just landing
  // on the list.
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(() => searchParams.get("edit") === task.id);
  const [expanded, setExpanded] = useState(false);
  // Reading sessionStorage during render is "impure" as far as React's
  // purity rules are concerned (same reasoning as the Notification.
  // permission / localStorage reads elsewhere in this app) — routed
  // through useSyncExternalStore, purely to flag leftover AI output on
  // the still-collapsed toggle rather than forcing it open (forcing it
  // open would fight the user's own expand/collapse clicks — OR'd
  // booleans can't be un-OR'd back to collapsed).
  const hasPersistedContent = useSyncExternalStore(
    subscribeNever,
    () =>
      readPersisted(`task-suggested-${task.id}`) !== null ||
      readPersisted(`task-draft-email-${task.id}`) !== null ||
      readPersisted(`task-draft-doc-${task.id}`) !== null,
    () => false,
  );
  const [newSubtask, setNewSubtask] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [suggested, setSuggested] = usePersistedState<string[]>(`task-suggested-${task.id}`, null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draft, setDraft] = usePersistedState<{ subject: string; body: string; to?: string }>(`task-draft-email-${task.id}`, null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [isDraftingDoc, setIsDraftingDoc] = useState(false);
  const [draftDocError, setDraftDocError] = useState<string | null>(null);
  const [docDraft, setDocDraft] = usePersistedState<{ title: string; body: string }>(`task-draft-doc-${task.id}`, null);
  const [copyDocStatus, setCopyDocStatus] = useState<"idle" | "copied">("idle");
  const [delaying, setDelaying] = useState(false);
  const [delayDate, setDelayDate] = useState("");

  // Unscheduled and either overdue or due within 48h — a scheduled task
  // (task.event set) already has a slot on the calendar, so it's not
  // "at risk" in the same way even if the due date is close.
  const dueSoonMs = 48 * 60 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const isOverdue = Boolean(task.dueAt && task.dueAt.getTime() < now && !task.event);
  const isDueSoon =
    !isOverdue &&
    Boolean(task.dueAt && task.dueAt.getTime() - now < dueSoonMs && !task.event);

  const liveTrackedMinutes = Math.round(
    task.trackedMinutes +
      (task.timerStartedAt ? Math.max(0, now - task.timerStartedAt.getTime()) / 60_000 : 0),
  );

  // "Ongoing" shows automatically while now falls inside the task's
  // scheduled window, even if the stored status is still CREATED — a
  // display-only computation, nothing is written to the DB for this.
  // A manually-set ONGOING/DELAYED/DONE status always wins.
  const isCurrentlyInSlot = Boolean(
    task.event && task.event.start.getTime() <= now && now < task.event.start.getTime() + task.durationMin * 60_000,
  );
  const displayStatus: TaskStatus =
    task.status === "CREATED" && isCurrentlyInSlot ? "ONGOING" : task.status;

  const openDelay = () => {
    const base = task.dueAt ?? new Date();
    const suggested = new Date(base.getTime() + 3 * 86_400_000);
    setDelayDate(toDateInputValue(suggested));
    setDelaying(true);
  };

  const handleDelaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delayDate) return;
    await delayTaskAction(task.id, new Date(`${delayDate}T23:59:00`).toISOString());
    setDelaying(false);
  };

  const doneSubtasks = task.subtasks.filter((s) => s.status === "DONE").length;

  const modalTask: TaskModalTask = {
    id: task.id,
    title: task.title,
    status: task.status,
    notes: task.notes,
    priority: task.priority,
    durationMin: task.durationMin,
    projectId: task.projectId,
    assigneeId: task.assigneeId,
    timeSlotId: task.timeSlotId,
    startAt: task.startAt,
    dueAt: task.dueAt,
    recurrenceRule: task.recurrenceRule,
    color: task.color,
    hardDeadline: task.hardDeadline,
    chunkMin: task.chunkMin,
    labels: task.labels,
    blockedBy: task.blockedBy,
  };
  const isBlocked = task.blockedBy.some((b) => b.status !== "DONE");
  const blockableTasks = otherTasks.filter((t) => t.id !== task.id);

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtask.trim() || isAddingSubtask) return;
    setIsAddingSubtask(true);
    try {
      await createSubtaskAction(task.id, newSubtask);
      setNewSubtask("");
    } finally {
      setIsAddingSubtask(false);
    }
  };

  const handleGenerateSubtasks = async () => {
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const result = await generateSubtasksAction(task.id);
      if (!result.ok) {
        setGenerateError(result.error);
        return;
      }
      setSuggested(result.subtasks);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAcceptSuggested = async () => {
    if (!suggested) return;
    setIsAddingSubtask(true);
    try {
      await createSubtasksBulkAction(task.id, suggested);
      setSuggested(null);
    } finally {
      setIsAddingSubtask(false);
    }
  };

  const handleDraftEmail = async () => {
    setIsDrafting(true);
    setDraftError(null);
    try {
      const result = await draftTaskEmailAction(task.id);
      if (!result.ok) {
        setDraftError(result.error);
        return;
      }
      setDraft(result.draft);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleCopyDraft = async () => {
    if (!draft) return;
    const toLine = draft.to ? `To: ${draft.to}\n` : "";
    await navigator.clipboard.writeText(`${toLine}Subject: ${draft.subject}\n\n${draft.body}`);
    setCopyStatus("copied");
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  const handleDraftDoc = async () => {
    setIsDraftingDoc(true);
    setDraftDocError(null);
    try {
      const result = await draftTaskDocAction(task.id);
      if (!result.ok) {
        setDraftDocError(result.error);
        return;
      }
      setDocDraft(result.doc);
    } finally {
      setIsDraftingDoc(false);
    }
  };

  const handleCopyDoc = async () => {
    if (!docDraft) return;
    await navigator.clipboard.writeText(`${docDraft.title}\n\n${docDraft.body}`);
    setCopyDocStatus("copied");
    setTimeout(() => setCopyDocStatus("idle"), 2000);
  };

  // Clicking anywhere on the card opens the edit modal, except on the
  // card's own interactive controls (checkbox, action buttons, subtask
  // list, etc.) — those keep their own click handling.
  const onCardClick = (e: React.MouseEvent<HTMLLIElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, form")) return;
    setEditing(true);
  };

  return (
    <li
      onClick={onCardClick}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      className={`rounded-xl border border-rule bg-surface p-3 transition-colors hover:bg-rule-soft/40 ${
        onDragStart ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${pending ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3">
        <form action={toggleTaskDone.bind(null, task.id, task.status !== "DONE")}>
          <button
            type="submit"
            aria-label={task.status === "DONE" ? "reopen task" : "mark done"}
            title={task.status === "DONE" ? "Reopen" : "Mark done"}
            className={
              task.status === "DONE"
                ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink bg-ink text-[10px] text-paper transition-all hover:scale-110 focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-2"
                : "h-5 w-5 shrink-0 rounded-full border border-rule bg-surface transition-all hover:scale-110 hover:border-accent focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-2"
            }
          >
            {task.status === "DONE" ? "✓" : ""}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 flex-col justify-center text-left"
        >
          <p className="truncate text-sm font-medium">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[displayStatus]}`}
            >
              {STATUS_LABEL[displayStatus]}
            </span>
            {task.project && (() => {
              const badgeColor = task.color ?? task.project.color;
              const custom = isCustomColor(badgeColor);
              return (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    custom ? "" : (PROJECT_COLOR_BADGE[badgeColor] ?? PROJECT_COLOR_BADGE.zinc)
                  }`}
                  style={custom ? customColorStyle(badgeColor).badge : undefined}
                >
                  {task.project.name}
                </span>
              );
            })()}
            {task.assignee && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rule-soft px-2 py-0.5 text-xs font-medium text-ink-2">
                {task.assignee.type === "AI" ? (
                  <RobotIcon className="h-3 w-3" />
                ) : (
                  <PersonIcon className="h-3 w-3" />
                )}
                {task.assignee.name}
              </span>
            )}
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}
            >
              {PRIORITY_LABEL[task.priority]}
            </span>
            <span>
              {task.durationMin}m est.
              {(task.trackedMinutes > 0 || task.timerStartedAt) && (
                <>
                  {" · "}
                  {liveTrackedMinutes}m tracked
                  {task.timerStartedAt && " (running)"}
                </>
              )}
            </span>
            {task.startAt && <span>· starts {task.startAt.toLocaleDateString()}</span>}
            {task.dueAt && (
              <span>
                · due {formatDueDateTime(task.dueAt)}
                {!task.hardDeadline && <span className="text-muted"> (soft)</span>}
              </span>
            )}
            {(isOverdue || isDueSoon) && (
              <span
                className={
                  isOverdue
                    ? "inline-flex items-center gap-1 rounded-full bg-accent-wash px-2 py-0.5 text-xs font-medium text-accent"
                    : "inline-flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-xs font-medium text-accent"
                }
                title={isOverdue ? "Past due and not scheduled" : "Due soon and not scheduled"}
              >
                <AlertTriangleIcon />
                {isOverdue ? "Overdue" : "Due soon"}
              </span>
            )}
            {task.recurrenceRule && (
              <span
                className="inline-flex items-center gap-0.5"
                title="Repeats — completing it creates the next occurrence"
              >
                <RepeatIcon /> repeats
              </span>
            )}
            {task.event && (
              <span>
                · {task.event.locked ? "scheduled" : "auto-scheduled"} {formatDueDateTime(task.event.start)}
                {task.eventCount > 1 && (
                  <span className="text-muted"> (1 of {task.eventCount} chunks)</span>
                )}
              </span>
            )}
            {isBlocked && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-rule-soft px-2 py-0.5 text-xs font-medium text-ink-2"
                title={`Blocked by: ${task.blockedBy.map((b) => b.title).join(", ")}`}
              >
                Blocked
              </span>
            )}
            {task.labels.map((label) => (
              <span
                key={label.id}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PROJECT_COLOR_BADGE[label.color] ?? PROJECT_COLOR_BADGE.zinc}`}
              >
                {label.name}
              </span>
            ))}
          </div>
        </button>
        {task.status === "CREATED" && (
          <form action={setTaskStatusAction.bind(null, task.id, "ONGOING")}>
            <button
              type="submit"
              title="Mark as ongoing — you're working on this now"
              className="rounded-lg border border-rule bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              Start
            </button>
          </form>
        )}
        {(task.status === "CREATED" || task.status === "ONGOING") && (
          <Link
            href={`/focus?taskId=${task.id}`}
            title="Start a focus session for this task"
            className="rounded-lg border border-rule bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
          >
            Focus
          </Link>
        )}
        {task.status === "ONGOING" && (
          <form action={setTaskStatusAction.bind(null, task.id, "CREATED")}>
            <button
              type="submit"
              title="Pause — stops the timer and folds elapsed time into tracked minutes"
              className="rounded-lg border border-rule bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              Pause
            </button>
          </form>
        )}
        {task.status === "DELAYED" && (
          <form action={setTaskStatusAction.bind(null, task.id, "CREATED")}>
            <button
              type="submit"
              title="Clear the delayed status"
              className="rounded-lg border border-rule bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              Un-delay
            </button>
          </form>
        )}
        {task.status !== "DELAYED" && (
          <button
            type="button"
            onClick={openDelay}
            title="Push the due date off and clear its calendar slot"
            className="rounded-lg border border-rule bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
          >
            Delay
          </button>
        )}
        <form
          action={
            task.event
              ? unscheduleTaskAction.bind(null, task.id)
              : scheduleTaskAction.bind(null, task.id)
          }
        >
          <button
            type="submit"
            className="rounded-lg border border-rule bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
          >
            {task.event ? "Unschedule" : "Schedule"}
          </button>
        </form>
        <ConfirmForm
          message={
            blockingTitles.length > 0
              ? `Delete this task? ${blockingTitles.join(", ")} ${blockingTitles.length > 1 ? "are" : "is"} blocked by it and will no longer be.`
              : "Delete this task?"
          }
          action={deleteTaskAction.bind(null, task.id)}
        >
          <button
            type="submit"
            aria-label="delete task"
            title="Delete task"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent-wash hover:text-accent"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </ConfirmForm>
      </div>

      {delaying && (
        <form
          onSubmit={handleDelaySubmit}
          className="mt-2 ml-8 flex items-center gap-2 rounded-lg border border-rule bg-rule-soft p-2"
        >
          <span className="text-xs text-muted">Push due date to</span>
          <input
            type="date"
            value={delayDate}
            onChange={(e) => setDelayDate(e.target.value)}
            className="rounded-lg border border-rule bg-surface px-2 py-1 text-xs"
          />
          <button
            type="submit"
            className="rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-paper hover:opacity-85"
          >
            Delay
          </button>
          <button
            type="button"
            onClick={() => setDelaying(false)}
            className="text-xs text-muted hover:text-ink"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="mt-2 pl-8">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
        >
          <ChevronRightIcon className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          {task.subtasks.length > 0
            ? `${doneSubtasks}/${task.subtasks.length} subtasks`
            : "Add subtask"}
          {!expanded && hasPersistedContent && (
            <span className="text-accent" title="Unsaved AI suggestions/drafts here">•</span>
          )}
        </button>

        {expanded && (
          <div className="mt-2 flex flex-col gap-1.5">
            {task.subtasks.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2">
                <form action={toggleTaskDone.bind(null, sub.id, sub.status !== "DONE")}>
                  <button
                    type="submit"
                    aria-label="toggle subtask done"
                    className={
                      sub.status === "DONE"
                        ? "flex h-4 w-4 items-center justify-center rounded-full bg-ink"
                        : "h-4 w-4 rounded-full border border-rule bg-surface transition-colors hover:border-accent"
                    }
                  />
                </form>
                <span
                  className={
                    sub.status === "DONE"
                      ? "flex-1 text-sm text-muted line-through"
                      : "flex-1 text-sm text-ink-2"
                  }
                >
                  {sub.title}
                </span>
                <ConfirmForm message="Delete this subtask?" action={deleteTaskAction.bind(null, sub.id)}>
                  <button
                    type="submit"
                    aria-label="delete subtask"
                    className="flex h-4 w-4 items-center justify-center rounded text-muted transition-colors hover:text-accent"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </ConfirmForm>
              </div>
            ))}
            <form onSubmit={handleAddSubtask} className="mt-1 flex items-center gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="New subtask…"
                className="w-full max-w-xs rounded-lg border border-rule bg-surface px-2 py-1 text-xs transition-colors focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={isAddingSubtask || !newSubtask.trim()}
                className="rounded-lg border border-rule px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft disabled:opacity-50"
              >
                Add
              </button>
            </form>

            {!suggested && (
              <button
                type="button"
                onClick={handleGenerateSubtasks}
                disabled={isGenerating}
                title="Also reads any files attached to this task — attach the assignment sheet for more accurate suggestions"
                className="mt-1 inline-flex w-fit items-center gap-1 text-xs text-ink-2 transition-colors hover:underline disabled:opacity-50"
              >
                <SparkleIcon className="h-3 w-3" />
                {isGenerating ? "Thinking…" : "Generate subtasks with AI"}
              </button>
            )}
            {generateError && (
              <p className="text-xs text-accent">{generateError}</p>
            )}
            {suggested && (
              <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-dashed border-rule p-2">
                <p className="text-xs font-medium text-ink">
                  Suggested subtasks
                </p>
                {suggested.length === 0 ? (
                  <p className="text-xs text-muted">No suggestions — try adding some notes to the task first.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {suggested.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-xs text-ink-2">
                        <span className="min-w-0 truncate">{s}</span>
                        <button
                          type="button"
                          onClick={() => setSuggested((prev) => prev?.filter((_, idx) => idx !== i) ?? null)}
                          aria-label="remove suggestion"
                          className="flex-shrink-0 text-muted hover:text-accent"
                        >
                          <CloseIcon className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSuggested(null)}
                    className="text-xs text-muted hover:text-ink"
                  >
                    Discard
                  </button>
                  {suggested.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAcceptSuggested}
                      disabled={isAddingSubtask}
                      className="rounded-lg bg-ink px-2 py-1 text-xs font-medium text-paper hover:opacity-85 disabled:opacity-50"
                    >
                      {isAddingSubtask ? "Adding…" : `Add ${suggested.length}`}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-2 border-t border-rule-soft pt-2">
              {!draft && (
                <button
                  type="button"
                  onClick={handleDraftEmail}
                  disabled={isDrafting}
                  className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:underline disabled:opacity-50"
                >
                  <SparkleIcon className="h-3 w-3" />
                  {isDrafting ? "Drafting…" : "Draft email with AI"}
                </button>
              )}
              {draftError && (
                <p className="text-xs text-accent">{draftError}</p>
              )}
              {draft && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-rule p-2">
                  {draft.to && (
                    <p className="text-xs text-muted">To: {draft.to}</p>
                  )}
                  <p className="text-xs font-medium text-ink">
                    {draft.subject}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-ink-2">
                    {draft.body}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDraft}
                      className="rounded-lg bg-ink px-2 py-1 text-xs font-medium text-paper hover:opacity-85"
                    >
                      {copyStatus === "copied" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-2 border-t border-rule-soft pt-2">
              {!docDraft && (
                <button
                  type="button"
                  onClick={handleDraftDoc}
                  disabled={isDraftingDoc}
                  className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:underline disabled:opacity-50"
                >
                  <SparkleIcon className="h-3 w-3" />
                  {isDraftingDoc ? "Drafting…" : "Draft doc with AI"}
                </button>
              )}
              {draftDocError && (
                <p className="text-xs text-accent">{draftDocError}</p>
              )}
              {docDraft && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-rule p-2">
                  <p className="text-xs font-medium text-ink">
                    {docDraft.title}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-ink-2">
                    {docDraft.body}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDocDraft(null)}
                      className="text-xs text-muted hover:text-ink"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDoc}
                      className="rounded-lg bg-ink px-2 py-1 text-xs font-medium text-paper hover:opacity-85"
                    >
                      {copyDocStatus === "copied" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {editing && (
        <TaskModal
          mode="edit"
          task={modalTask}
          projects={projects}
          assignees={assignees}
          timeSlots={timeSlots}
          labels={labels}
          otherTasks={blockableTasks}
          defaultProjectId={defaultProjectId}
          onClose={() => setEditing(false)}
        />
      )}
    </li>
  );
}
