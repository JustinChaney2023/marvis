"use client";

import { useState } from "react";
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
import { PersonIcon, RobotIcon, RepeatIcon, AlertTriangleIcon, ChevronRightIcon, CloseIcon, SparkleIcon } from "../icons";
import TaskModal, { type TaskModalTask } from "./TaskModal";
import { STATUS_BADGE, STATUS_LABEL, type TaskStatus } from "./taskStatus";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };
type TimeSlot = { id: string; name: string };

type Subtask = { id: string; title: string; status: TaskStatus };

export type TaskRowData = {
  id: string;
  title: string;
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
  project: { name: string; color: string } | null;
  assignee: { name: string; type: "HUMAN" | "AI" } | null;
  event: { start: Date } | null;
  subtasks: Subtask[];
};

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];
const PRIORITY_BADGE: Record<number, string> = {
  0: "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  1: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  2: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  3: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};
const PROJECT_COLOR_BADGE: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
};

export default function TaskRow({
  task,
  projects,
  assignees,
  timeSlots,
  defaultProjectId,
}: {
  task: TaskRowData;
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
  defaultProjectId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [isDraftingDoc, setIsDraftingDoc] = useState(false);
  const [draftDocError, setDraftDocError] = useState<string | null>(null);
  const [docDraft, setDocDraft] = useState<{ title: string; body: string } | null>(null);
  const [copyDocStatus, setCopyDocStatus] = useState<"idle" | "copied">("idle");
  const [delaying, setDelaying] = useState(false);
  const [delayDate, setDelayDate] = useState("");

  // Unscheduled and either overdue or due within 48h — a scheduled task
  // (task.event set) already has a slot on the calendar, so it's not
  // "at risk" in the same way even if the due date is close.
  const dueSoonMs = 48 * 60 * 60 * 1000;
  const now = Date.now();
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
    priority: task.priority,
    durationMin: task.durationMin,
    projectId: task.projectId,
    assigneeId: task.assigneeId,
    timeSlotId: task.timeSlotId,
    startAt: task.startAt,
    dueAt: task.dueAt,
    recurrenceRule: task.recurrenceRule,
  };

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
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
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

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-center gap-3">
        <form action={toggleTaskDone.bind(null, task.id, true)}>
          <button
            type="submit"
            aria-label="mark done"
            className="h-5 w-5 shrink-0 rounded-full border border-zinc-300 bg-white transition-all hover:scale-110 hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:ring-offset-zinc-900"
          />
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium hover:underline">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[displayStatus]}`}
            >
              {STATUS_LABEL[displayStatus]}
            </span>
            {task.project && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PROJECT_COLOR_BADGE[task.project.color] ?? PROJECT_COLOR_BADGE.zinc}`}
              >
                {task.project.name}
              </span>
            )}
            {task.assignee && (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
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
            {task.dueAt && <span>· due {task.dueAt.toLocaleString()}</span>}
            {(isOverdue || isDueSoon) && (
              <span
                className={
                  isOverdue
                    ? "inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    : "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
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
            {task.event && <span>· scheduled {task.event.start.toLocaleString()}</span>}
          </div>
        </button>
        {task.status === "CREATED" && (
          <form action={setTaskStatusAction.bind(null, task.id, "ONGOING")}>
            <button
              type="submit"
              title="Mark as ongoing — you're working on this now"
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            >
              Start
            </button>
          </form>
        )}
        {task.status === "ONGOING" && (
          <form action={setTaskStatusAction.bind(null, task.id, "CREATED")}>
            <button
              type="submit"
              title="Pause — stops the timer and folds elapsed time into tracked minutes"
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
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
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
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
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
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
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
          >
            {task.event ? "Unschedule" : "Schedule"}
          </button>
        </form>
        <form action={deleteTaskAction.bind(null, task.id)}>
          <button
            type="submit"
            aria-label="delete task"
            title="Delete task"
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>

      {delaying && (
        <form
          onSubmit={handleDelaySubmit}
          className="mt-2 ml-8 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-700/40"
        >
          <span className="text-xs text-zinc-500">Push due date to</span>
          <input
            type="date"
            value={delayDate}
            onChange={(e) => setDelayDate(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500"
          >
            Delay
          </button>
          <button
            type="button"
            onClick={() => setDelaying(false)}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="mt-2 pl-8">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronRightIcon className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          {task.subtasks.length > 0
            ? `${doneSubtasks}/${task.subtasks.length} subtasks`
            : "Add subtask"}
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
                        ? "flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 dark:bg-indigo-500"
                        : "h-4 w-4 rounded-full border border-zinc-300 bg-white transition-colors hover:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
                    }
                  />
                </form>
                <span
                  className={
                    sub.status === "DONE"
                      ? "flex-1 text-sm text-zinc-400 line-through"
                      : "flex-1 text-sm text-zinc-700 dark:text-zinc-300"
                  }
                >
                  {sub.title}
                </span>
                <form action={deleteTaskAction.bind(null, sub.id)}>
                  <button
                    type="submit"
                    aria-label="delete subtask"
                    className="flex h-4 w-4 items-center justify-center rounded text-zinc-300 transition-colors hover:text-red-600 dark:hover:text-red-400"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </form>
              </div>
            ))}
            <form onSubmit={handleAddSubtask} className="mt-1 flex items-center gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="New subtask…"
                className="w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              <button
                type="submit"
                disabled={isAddingSubtask || !newSubtask.trim()}
                className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                Add
              </button>
            </form>

            {!suggested && (
              <button
                type="button"
                onClick={handleGenerateSubtasks}
                disabled={isGenerating}
                className="mt-1 inline-flex w-fit items-center gap-1 text-xs text-indigo-600 transition-colors hover:underline disabled:opacity-50 dark:text-indigo-400"
              >
                <SparkleIcon className="h-3 w-3" />
                {isGenerating ? "Thinking…" : "Generate subtasks with AI"}
              </button>
            )}
            {generateError && (
              <p className="text-xs text-red-600 dark:text-red-400">{generateError}</p>
            )}
            {suggested && (
              <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-dashed border-indigo-300 p-2 dark:border-indigo-700">
                <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  Suggested subtasks
                </p>
                {suggested.length === 0 ? (
                  <p className="text-xs text-zinc-500">No suggestions — try adding some notes to the task first.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {suggested.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <span className="min-w-0 truncate">{s}</span>
                        <button
                          type="button"
                          onClick={() => setSuggested((prev) => prev?.filter((_, idx) => idx !== i) ?? null)}
                          aria-label="remove suggestion"
                          className="flex-shrink-0 text-zinc-300 hover:text-red-600 dark:hover:text-red-400"
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
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Discard
                  </button>
                  {suggested.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAcceptSuggested}
                      disabled={isAddingSubtask}
                      className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500"
                    >
                      {isAddingSubtask ? "Adding…" : `Add ${suggested.length}`}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-700/60">
              {!draft && (
                <button
                  type="button"
                  onClick={handleDraftEmail}
                  disabled={isDrafting}
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 transition-colors hover:underline disabled:opacity-50 dark:text-indigo-400"
                >
                  <SparkleIcon className="h-3 w-3" />
                  {isDrafting ? "Drafting…" : "Draft email with AI"}
                </button>
              )}
              {draftError && (
                <p className="text-xs text-red-600 dark:text-red-400">{draftError}</p>
              )}
              {draft && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-indigo-300 p-2 dark:border-indigo-700">
                  <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    {draft.subject}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                    {draft.body}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDraft}
                      className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500"
                    >
                      {copyStatus === "copied" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-700/60">
              {!docDraft && (
                <button
                  type="button"
                  onClick={handleDraftDoc}
                  disabled={isDraftingDoc}
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 transition-colors hover:underline disabled:opacity-50 dark:text-indigo-400"
                >
                  <SparkleIcon className="h-3 w-3" />
                  {isDraftingDoc ? "Drafting…" : "Draft doc with AI"}
                </button>
              )}
              {draftDocError && (
                <p className="text-xs text-red-600 dark:text-red-400">{draftDocError}</p>
              )}
              {docDraft && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-indigo-300 p-2 dark:border-indigo-700">
                  <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    {docDraft.title}
                  </p>
                  <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                    {docDraft.body}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDocDraft(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyDoc}
                      className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500"
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
          defaultProjectId={defaultProjectId}
          onClose={() => setEditing(false)}
        />
      )}
    </li>
  );
}
