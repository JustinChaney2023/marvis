"use client";

import { useState } from "react";
import { setTaskStatusAction, toggleTaskDone, delayTaskAction } from "../actions";
import TaskRow, { type TaskRowData } from "./TaskRow";
import { STATUS_LABEL, type TaskStatus } from "./taskStatus";

const COLUMNS: TaskStatus[] = ["CREATED", "ONGOING", "DELAYED", "DONE"];

// Moves a task from wherever it is to `to`, via whichever existing
// server action(s) that transition actually goes through — there's no
// single "set status" action because DONE and DELAYED each carry their
// own side effects (DONE stops the timer and may spawn a recurring
// task's next occurrence; DELAYED needs a new due date, not just a
// status flag). Reopening a DONE card first goes back to CREATED, then
// takes a second step if the actual target was ONGOING or DELAYED.
async function moveTask(task: TaskRowData, to: TaskStatus) {
  if (to === task.status) return;

  if (task.status === "DONE") {
    await toggleTaskDone(task.id, false);
  }

  if (to === "DONE") {
    await toggleTaskDone(task.id, true);
  } else if (to === "ONGOING") {
    await setTaskStatusAction(task.id, "ONGOING");
  } else if (to === "CREATED") {
    // DONE already landed on CREATED via the reopen above. ONGOING->CREATED
    // is "Pause"; DELAYED->CREATED is "Un-delay" — both go through the
    // same action now that it accepts DELAYED as a source status too.
    if (task.status === "ONGOING" || task.status === "DELAYED") {
      await setTaskStatusAction(task.id, "CREATED");
    }
  } else if (to === "DELAYED") {
    // Same "push it 3 days" default the row's own Delay button suggests.
    const base = task.dueAt ?? new Date();
    const suggested = new Date(base.getTime() + 3 * 86_400_000);
    await delayTaskAction(task.id, new Date(`${suggested.toISOString().slice(0, 10)}T23:59:00`).toISOString());
  }
}

// Deliberately just a grouped re-render of the existing TaskRow, plus
// drag-and-drop between columns — Motion's kanban is the most commonly
// cited source of "cluttered and overwhelming" feedback; this stays
// plain columns of the same rows already used in the list view.
export default function TaskBoard({
  tasks,
  done,
  projects,
  assignees,
  timeSlots,
  labels,
  otherTasks,
  defaultProjectId,
}: {
  tasks: TaskRowData[];
  done: TaskRowData[];
  projects: { id: string; name: string; color: string }[];
  assignees: { id: string; name: string; type: "HUMAN" | "AI" }[];
  timeSlots: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  otherTasks: { id: string; title: string }[];
  defaultProjectId: string;
}) {
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const byStatus: Record<TaskStatus, TaskRowData[]> = {
    CREATED: [],
    ONGOING: [],
    DELAYED: [],
    DONE: done,
  };
  for (const task of tasks) {
    if (task.status !== "DONE") byStatus[task.status].push(task);
  }
  const allById = new Map([...tasks, ...done].map((t) => [t.id, t]));

  const handleDrop = async (e: React.DragEvent, to: TaskStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData("text/plain");
    const task = allById.get(taskId);
    if (!task) return;
    setPendingId(taskId);
    try {
      await moveTask(task, to);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((status) => (
        <div
          key={status}
          className="min-w-0"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverColumn(status);
          }}
          onDragLeave={() => setDragOverColumn((c) => (c === status ? null : c))}
          onDrop={(e) => handleDrop(e, status)}
        >
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-wide text-muted uppercase">
            {STATUS_LABEL[status]}
            <span className="rounded-full bg-rule-soft px-1.5 py-0.5 text-xs font-medium text-muted">
              {byStatus[status].length}
            </span>
          </h2>
          <ul
            className={`space-y-2 rounded-xl transition-colors ${
              dragOverColumn === status ? "outline outline-2 outline-dashed outline-accent" : ""
            }`}
          >
            {byStatus[status].map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projects={projects}
                assignees={assignees}
                timeSlots={timeSlots}
                labels={labels}
                otherTasks={otherTasks}
                defaultProjectId={defaultProjectId}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
                pending={pendingId === task.id}
              />
            ))}
            {byStatus[status].length === 0 && (
              <li className="rounded-xl border border-dashed border-rule py-6 text-center text-xs text-muted">
                Nothing here
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
