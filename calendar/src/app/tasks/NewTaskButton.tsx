"use client";

import { useState } from "react";
import { PlusIcon } from "../icons";
import TaskModal from "./TaskModal";
import Button from "../ui/Button";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };

export default function NewTaskButton({
  projects,
  assignees,
  defaultProjectId,
}: {
  projects: Project[];
  assignees: Assignee[];
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
          defaultProjectId={defaultProjectId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
