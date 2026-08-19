import TaskRow, { type TaskRowData } from "./TaskRow";
import { STATUS_LABEL, type TaskStatus } from "./taskStatus";

const COLUMNS: TaskStatus[] = ["CREATED", "ONGOING", "DELAYED", "DONE"];

// Deliberately just a grouped re-render of the existing TaskRow — no new
// drag-and-drop or status-change logic. Motion's kanban is the most
// commonly cited source of "cluttered and overwhelming" feedback; this
// stays plain columns of the same rows already used in the list view.
export default function TaskBoard({
  tasks,
  done,
  projects,
  assignees,
  timeSlots,
  defaultProjectId,
}: {
  tasks: TaskRowData[];
  done: TaskRowData[];
  projects: { id: string; name: string; color: string }[];
  assignees: { id: string; name: string; type: "HUMAN" | "AI" }[];
  timeSlots: { id: string; name: string }[];
  defaultProjectId: string;
}) {
  const byStatus: Record<TaskStatus, TaskRowData[]> = {
    CREATED: [],
    ONGOING: [],
    DELAYED: [],
    DONE: done,
  };
  for (const task of tasks) {
    if (task.status !== "DONE") byStatus[task.status].push(task);
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((status) => (
        <div key={status} className="min-w-0">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            {STATUS_LABEL[status]}
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
              {byStatus[status].length}
            </span>
          </h2>
          <ul className="space-y-2">
            {byStatus[status].map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projects={projects}
                assignees={assignees}
                timeSlots={timeSlots}
                defaultProjectId={defaultProjectId}
              />
            ))}
            {byStatus[status].length === 0 && (
              <li className="rounded-xl border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-400 dark:border-zinc-700">
                Nothing here
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
