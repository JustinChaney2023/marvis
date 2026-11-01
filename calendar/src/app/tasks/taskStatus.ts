export type TaskStatus = "CREATED" | "ONGOING" | "DELAYED" | "DONE";

export const STATUS_BADGE: Record<TaskStatus, string> = {
  CREATED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  ONGOING: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  DELAYED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  CREATED: "To do",
  ONGOING: "Ongoing",
  DELAYED: "Delayed",
  DONE: "Completed",
};

const DUE_SOON_MS = 48 * 60 * 60 * 1000;

/**
 * "overdue" / "soon" (due within 48h) for an open task, else null — the
 * single rule the task list and the calendar blocks both turn red on.
 */
export function dueUrgency(
  dueAt: Date | null,
  status: TaskStatus | null,
  now: number,
): "overdue" | "soon" | null {
  if (!dueAt || status === "DONE") return null;
  const left = dueAt.getTime() - now;
  return left < 0 ? "overdue" : left < DUE_SOON_MS ? "soon" : null;
}
