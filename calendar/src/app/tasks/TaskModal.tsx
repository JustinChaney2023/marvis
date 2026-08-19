"use client";

import { useState } from "react";
import { createTask, updateTask } from "../actions";
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
};

type Props = {
  mode: "create" | "edit";
  task?: TaskModalTask;
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
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
  defaultProjectId,
  defaultAssigneeId,
  onClose,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
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
                <span className="block h-6 w-11 rounded-full bg-zinc-200 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 dark:bg-zinc-700 dark:peer-checked:bg-indigo-500" />
                <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          )}

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Repeat</span>
              <select
                value={recurrenceSelection}
                onChange={(e) => setRecurrenceSelection(e.target.value)}
                disabled={!hasDueDate}
                title={hasDueDate ? undefined : "Set a due date to repeat this task"}
                className={inputClass}
              >
                {RECURRENCE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
                <option value="CUSTOM">Custom</option>
              </select>
              {!hasDueDate && (
                <span className="text-xs text-zinc-400">Set a due date to enable repeat.</span>
              )}
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
                            ? "flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
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
