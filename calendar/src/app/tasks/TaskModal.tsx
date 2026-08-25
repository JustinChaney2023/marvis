"use client";

import { useEffect, useRef, useState } from "react";
import {
  createTask,
  updateTask,
  getTaskActivityAction,
  addTaskCommentAction,
  addTaskAttachmentAction,
  deleteTaskAttachmentAction,
  type TaskActivityEntry,
} from "../actions";
import { CloseIcon } from "../icons";
import Button from "../ui/Button";
import { toLocalInputValue, formatYMD } from "@/lib/calendar-dates";
import {
  RECURRENCE_PRESETS,
  WEEKDAY_CODES,
  buildCustomWeeklyRule,
  parseCustomWeeklyDays,
  type WeekdayCode,
} from "@/lib/recurrence";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";
import DatePicker from "../ui/DatePicker";
import NotesEditor from "../ui/NotesEditor";

const TASK_COLOR_OPTIONS = Object.keys(PROJECT_EVENT_COLORS);

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };
type TimeSlot = { id: string; name: string };
type Label = { id: string; name: string; color: string };
type TaskOption = { id: string; title: string };

export type TaskModalTask = {
  id: string;
  title: string;
  notes: string | null;
  priority: number;
  durationMin: number;
  projectId: string | null;
  assigneeId: string | null;
  timeSlotId: string | null;
  startAt: Date | null;
  dueAt: Date | null;
  recurrenceRule: string | null;
  color: string | null;
  hardDeadline: boolean;
  chunkMin: number | null;
  labels: { id: string }[];
  blockedBy: { id: string }[];
};

type Props = {
  mode: "create" | "edit";
  task?: TaskModalTask;
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
  labels: Label[];
  // Other open tasks this one can depend on — the task's own id (in edit
  // mode) is filtered out by the caller, not here.
  otherTasks: TaskOption[];
  defaultProjectId: string;
  // Only meaningful in create mode — edit mode always uses the task's
  // own already-saved assigneeId (including explicitly unassigned),
  // never this.
  defaultAssigneeId?: string;
  onClose: () => void;
};

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];
const DURATION_PRESETS_MIN = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
// Picking just a due *date* with no time used to leave the time at
// midnight (a browser datetime-local default nobody wants for a task
// due date) — default to end-of-workday instead.
const DEFAULT_DUE_TIME = "17:00";
const WEEKDAY_SHORT_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const WEEKDAY_FULL_LABELS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function TaskModal({
  mode,
  task,
  projects,
  assignees,
  timeSlots,
  labels,
  otherTasks,
  defaultProjectId,
  defaultAssigneeId,
  onClose,
}: Props) {
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>(
    () => task?.labels.map((l) => l.id) ?? [],
  );
  const toggleLabel = (id: string) => {
    setSelectedLabelIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };
  const [selectedBlockedByIds, setSelectedBlockedByIds] = useState<string[]>(
    () => task?.blockedBy.map((t) => t.id) ?? [],
  );
  const toggleBlockedBy = (id: string) => {
    setSelectedBlockedByIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activity, setActivity] = useState<TaskActivityEntry[]>([]);
  const [commentText, setCommentText] = useState("");
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const refreshActivity = async () => {
    if (!task) return;
    setActivity(await getTaskActivityAction(task.id));
  };
  useEffect(() => {
    if (mode === "edit" && task) refreshActivity();
  }, [mode, task]);

  const handleAddComment = async () => {
    if (!task || !commentText.trim() || isPostingComment) return;
    setIsPostingComment(true);
    try {
      await addTaskCommentAction(task.id, commentText);
      setCommentText("");
      await refreshActivity();
    } finally {
      setIsPostingComment(false);
    }
  };

  const handleUploadAttachment = async (file: File) => {
    if (!task || isUploadingAttachment) return;
    setIsUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/uploads/attachments", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setAttachmentError(data.error ?? "Upload failed.");
        return;
      }
      await addTaskAttachmentAction(task.id, data);
      await refreshActivity();
    } finally {
      setIsUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    await deleteTaskAttachmentAction(attachmentId);
    await refreshActivity();
  };

  const [recurrenceSelection, setRecurrenceSelection] = useState<string>(() => {
    const rule = task?.recurrenceRule ?? "";
    if (RECURRENCE_PRESETS.some((p) => p.value === rule)) return rule;
    return rule ? "CUSTOM" : "";
  });
  const [customDays, setCustomDays] = useState<WeekdayCode[]>(() =>
    task?.recurrenceRule ? (parseCustomWeeklyDays(task.recurrenceRule) ?? []) : [],
  );
  const [startAtValue, setStartAtValue] = useState(task?.startAt ? formatYMD(task.startAt) : "");
  const [dueAtDateValue, setDueAtDateValue] = useState(task?.dueAt ? formatYMD(task.dueAt) : "");
  const hasDueDate = Boolean(dueAtDateValue);
  const initialDuration = task?.durationMin ?? 30;
  // A single always-editable number input, not a two-step "pick Custom,
  // then a text field appears" — the preset dropdown is just a quick-fill
  // shortcut into the same field, not a separate mode.
  const [durationValue, setDurationValue] = useState(String(initialDuration));
  const [chunkMinValue, setChunkMinValue] = useState(task?.chunkMin ? String(task.chunkMin) : "");

  const toggleDay = (code: WeekdayCode) => {
    setCustomDays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    const formData = new FormData(e.currentTarget);

    const ruleValue =
      recurrenceSelection === "CUSTOM"
        ? buildCustomWeeklyRule(customDays)
        : recurrenceSelection;
    formData.set("recurrenceRule", ruleValue);

    setIsSubmitting(true);
    try {
      if (mode === "edit" && task) {
        await updateTask(task.id, formData);
      } else {
        await createTask(formData);
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-panel max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {mode === "edit" ? "Edit task" : "New task"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Title</span>
            <input
              name="title"
              required
              autoFocus
              defaultValue={task?.title ?? ""}
              placeholder="What needs doing?"
              className={inputClass}
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Notes</span>
            <NotesEditor name="notes" defaultValue={task?.notes ?? ""} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Priority</span>
              <select name="priority" defaultValue={String(task?.priority ?? 0)} className={inputClass}>
                {PRIORITY_LABEL.map((label, value) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Duration</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  name="durationMin"
                  value={durationValue}
                  onChange={(e) => setDurationValue(e.target.value)}
                  min={1}
                  step={1}
                  aria-label="Duration in minutes"
                  className={inputClass}
                />
                <span className="text-xs text-zinc-400">min</span>
              </div>
              <select
                value=""
                aria-label="Common durations"
                onChange={(e) => {
                  if (e.target.value) setDurationValue(e.target.value);
                }}
                className={`${inputClass} mt-1 text-xs text-zinc-400`}
              >
                <option value="">Common durations…</option>
                {DURATION_PRESETS_MIN.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Project</span>
              <select name="projectId" defaultValue={task?.projectId ?? defaultProjectId} className={inputClass}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Assign to</span>
              <select
                name="assigneeId"
                defaultValue={task ? task.assigneeId ?? "" : defaultAssigneeId ?? ""}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.type === "AI" ? " (AI)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Color</span>
              <select name="color" defaultValue={task?.color ?? ""} className={inputClass}>
                <option value="">Use project color</option>
                {TASK_COLOR_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Min chunk</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  name="chunkMin"
                  value={chunkMinValue}
                  onChange={(e) => setChunkMinValue(e.target.value)}
                  min={1}
                  step={1}
                  placeholder="No chunking"
                  aria-label="Split into chunks of this many minutes"
                  className={inputClass}
                />
              </div>
              <span className="text-xs text-zinc-400">min per piece, with breaks between</span>
            </label>
          </div>

          <input type="hidden" name="labelIds" value={selectedLabelIds.join(",")} />
          {labels.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Labels</span>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const selected = selectedLabelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleLabel(label.id)}
                      className={
                        selected
                          ? "rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                          : "rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
                      }
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <input type="hidden" name="blockedByIds" value={selectedBlockedByIds.join(",")} />
          {otherTasks.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-500">
                Blocked by{selectedBlockedByIds.length > 0 ? ` (${selectedBlockedByIds.length})` : ""}
              </summary>
              <div className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-600">
                {otherTasks.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedBlockedByIds.includes(t.id)}
                      onChange={() => toggleBlockedBy(t.id)}
                    />
                    <span className="truncate">{t.title}</span>
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-xs text-zinc-400">
                Won&apos;t be auto-scheduled until everything checked here is Done.
              </span>
            </details>
          )}

          {timeSlots.length > 0 && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Time slot</span>
              <select name="timeSlotId" defaultValue={task?.timeSlotId ?? ""} className={inputClass}>
                <option value="">Default (9am-6pm weekdays)</option>
                {timeSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Start date</span>
              <DatePicker name="startAt" value={startAtValue} onChange={setStartAtValue} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Due</span>
              <div className="flex flex-col gap-1.5">
                <DatePicker name="dueAtDate" value={dueAtDateValue} onChange={setDueAtDateValue} />
                <input
                  type="time"
                  name="dueAtTime"
                  defaultValue={task?.dueAt ? toLocalInputValue(task.dueAt).slice(11) : DEFAULT_DUE_TIME}
                  className={inputClass}
                />
              </div>
            </label>
          </div>

          {hasDueDate && (
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">
                Hard deadline{" "}
                <span className="text-zinc-500 dark:text-zinc-400">
                  (must make this date — outranks soft-deadline tasks for open slots)
                </span>
              </span>
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  name="hardDeadline"
                  defaultChecked={task?.hardDeadline ?? true}
                  className="peer sr-only"
                />
                <span className="block h-6 w-11 rounded-full bg-zinc-200 transition-colors peer-checked:bg-zinc-900 peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-500/40 dark:bg-zinc-700 dark:peer-checked:bg-white" />
                <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          )}

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Repeat</span>
              <select
                value={recurrenceSelection}
                onChange={(e) => {
                  const value = e.target.value;
                  setRecurrenceSelection(value);
                  // The due date IS the recurrence anchor (its first
                  // occurrence), not a separate prerequisite — picking a
                  // repeat with no due date set yet defaults it to today
                  // rather than blocking the choice on a date first.
                  if (value && !dueAtDateValue) setDueAtDateValue(formatYMD(new Date()));
                }}
                className={inputClass}
              >
                {RECURRENCE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
                <option value="CUSTOM">Custom</option>
              </select>
              {recurrenceSelection === "CUSTOM" && (
                <div className="mt-1.5 flex gap-1.5">
                  {WEEKDAY_CODES.map((code, idx) => {
                    const selected = customDays.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={selected}
                        aria-label={WEEKDAY_FULL_LABELS[idx]}
                        onClick={() => toggleDay(code)}
                        className={
                          selected
                            ? "flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                            : "flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        }
                      >
                        {WEEKDAY_SHORT_LABELS[idx]}
                      </button>
                    );
                  })}
                </div>
              )}
            </label>
          </div>

          {mode === "edit" && task && (
            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-700">
              <span className="text-zinc-500">Attachments</span>
              <div className="flex flex-col gap-1.5">
                {activity
                  .filter((e) => e.attachment)
                  .map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-zinc-600"
                    >
                      <a
                        href={e.attachment!.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {e.attachment!.filename}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteAttachment(e.attachment!.id)}
                        className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        aria-label={`Remove ${e.attachment!.filename}`}
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
              <input
                ref={attachmentInputRef}
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadAttachment(file);
                }}
                disabled={isUploadingAttachment}
                className="text-xs text-zinc-500"
              />
              {attachmentError && (
                <span className="text-xs text-red-600 dark:text-red-400">{attachmentError}</span>
              )}

              <span className="mt-2 text-zinc-500">Activity</span>
              <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                {activity.length === 0 && (
                  <span className="text-xs text-zinc-400">No activity yet.</span>
                )}
                {activity
                  .filter((e) => !e.attachment)
                  .map((e) => (
                    <div key={e.id} className="text-xs">
                      <span className="text-zinc-400">
                        {e.createdAt.toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>{" "}
                      <span className={e.kind === "comment" ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500"}>
                        {e.detail}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(ev) => setCommentText(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      handleAddComment();
                    }
                  }}
                  placeholder="Add a comment…"
                  className={`${inputClass} flex-1`}
                />
                <Button type="button" variant="secondary" pending={isPostingComment} onClick={handleAddComment}>
                  Comment
                </Button>
              </div>
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" pending={isSubmitting}>
              {isSubmitting ? "Saving…" : mode === "edit" ? "Save" : "Add task"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
