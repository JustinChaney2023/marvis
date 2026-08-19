"use client";

import { useState } from "react";
import { PlusIcon } from "../icons";
import TaskModal from "./TaskModal";
import Button from "../ui/Button";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };
type TimeSlot = { id: string; name: string };

export default function NewTaskButton({
  projects,
  assignees,
  timeSlots,
  defaultProjectId,
}: {
  projects: Project[];
  assignees: Assignee[];
  timeSlots: TimeSlot[];
  defaultProjectId: string;
}) {
  const [open, setOpen] = useState(false);

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
          defaultProjectId={defaultProjectId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
