"use client";

import { useEffect, useState } from "react";
import { PlusIcon } from "../icons";
import TaskModal from "./TaskModal";
import Button from "../ui/Button";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };
type TimeSlot = { id: string; name: string };
type Label = { id: string; name: string; color: string };
type TaskOption = { id: string; title: string };

export default function NewTaskButton({
  projects,
  assignees,
  timeSlots,
  labels,
  otherTasks,
  defaultProjectId,
  defaultAssigneeId,
  initialOpen = false,
}: {
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
  labels: Label[];
  otherTasks: TaskOption[];
  defaultProjectId: string;
  defaultAssigneeId?: string;
  // /tasks?new=1 (quick capture's "Full form" link) lands with it open.
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.key === "n") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <PlusIcon className="h-4 w-4" />
        New task
      </Button>
      {open && (
        <TaskModal
          mode="create"
          projects={projects}
          assignees={assignees}
          timeSlots={timeSlots}
          labels={labels}
          otherTasks={otherTasks}
          defaultProjectId={defaultProjectId}
          defaultAssigneeId={defaultAssigneeId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
