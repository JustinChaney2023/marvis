"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toggleTaskDone } from "../actions";
import { formatDueDateTime } from "@/lib/calendar-dates";
import TaskModal, { type TaskModalTask } from "./TaskModal";
import { STATUS_BADGE, STATUS_LABEL, type TaskStatus } from "./taskStatus";
import type { TaskRowData } from "./TaskRow";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };
type TimeSlot = { id: string; name: string };
type Label = { id: string; name: string; color: string };
type TaskOption = { id: string; title: string };

const PRIORITY_LABEL = ["Low", "Medium", "High", "Urgent"];

// Dense Deadline/Status/Priority/Duration/Assignee columns grouped by
// Project → Status — Motion's list view, distinct from this app's
// existing card-row "List" (TaskRow, one per task with inline actions).
// This view is read-dense on purpose: no per-row action buttons, just
// the title (click to edit) and the columns Motion's own panel shows.
export default function TaskTable({
  tasks,
  projects,
  assignees,
  timeSlots,
  labels,
  otherTasks,
  defaultProjectId,
}: {
  tasks: TaskRowData[];
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
  labels: Label[];
  otherTasks: TaskOption[];
  defaultProjectId: string;
}) {
  // Deep-link from the calendar's "Upcoming" list, same as TaskRow.
  const searchParams = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(() => {
    const id = searchParams.get("edit");
    return id && tasks.some((t) => t.id === id) ? id : null;
  });
  const editingTask = tasks.find((t) => t.id === editingId) ?? null;

  const noProject = { id: "__none__", name: "No project" };
  const groups = [...projects, noProject]
    .map((project) => ({
      project,
      rows: tasks.filter((t) => (t.projectId ?? "__none__") === project.id),
    }))
    .filter((g) => g.rows.length > 0);

  const STATUS_ORDER: TaskStatus[] = ["ONGOING", "CREATED", "DELAYED", "DONE"];

  return (
    <div className="mt-6 flex flex-col gap-6">
      {groups.map(({ project, rows }) => (
        <div key={project.id} className="overflow-x-auto rounded-xl border border-rule">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="border-b border-rule bg-rule-soft px-3 py-1.5 text-left font-mono text-[11px] tracking-wide text-muted uppercase caption-top">
              {project.name}
            </caption>
            <thead className="bg-rule-soft text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Deadline</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
                .map((task) => (
                  <tr
                    key={task.id}
                    className="border-t border-rule-soft hover:bg-rule-soft/60"
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(task.id)}
                        className="flex items-center gap-2 text-left hover:underline"
                      >
                        <input
                          type="checkbox"
                          checked={task.status === "DONE"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => toggleTaskDone(task.id, e.target.checked)}
                          className="flex-shrink-0"
                        />
                        <span className={task.status === "DONE" ? "line-through text-muted" : ""}>
                          {task.title}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {task.dueAt ? formatDueDateTime(task.dueAt) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[task.status]}`}
                      >
                        {STATUS_LABEL[task.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{PRIORITY_LABEL[task.priority]}</td>
                    <td className="px-3 py-2 text-muted">{task.durationMin}m</td>
                    <td className="px-3 py-2 text-muted">{task.assignee?.name ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-rule py-8 text-center text-sm text-muted">
          No open tasks.
        </p>
      )}

      {editingTask && (
        <TaskModal
          mode="edit"
          task={
            {
              id: editingTask.id,
              title: editingTask.title,
              notes: editingTask.notes,
              priority: editingTask.priority,
              durationMin: editingTask.durationMin,
              projectId: editingTask.projectId,
              assigneeId: editingTask.assigneeId,
              timeSlotId: editingTask.timeSlotId,
              startAt: editingTask.startAt,
              dueAt: editingTask.dueAt,
              recurrenceRule: editingTask.recurrenceRule,
              color: editingTask.color,
              hardDeadline: editingTask.hardDeadline,
              chunkMin: editingTask.chunkMin,
              labels: editingTask.labels,
              blockedBy: editingTask.blockedBy,
            } satisfies TaskModalTask
          }
          projects={projects}
          assignees={assignees}
          timeSlots={timeSlots}
          labels={labels}
          otherTasks={otherTasks.filter((t) => t.id !== editingTask.id)}
          defaultProjectId={defaultProjectId}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
