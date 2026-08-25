"use client";

import { useState } from "react";
import { updateProjectNotesAction } from "../../actions";
import Button from "../../ui/Button";
import NotesEditor from "../../ui/NotesEditor";

export default function ProjectNotesEditor({
  projectId,
  initialNotes,
}: {
  projectId: string;
  initialNotes: string;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    setSaved(false);
    try {
      const notes = String(new FormData(e.currentTarget).get("notes") ?? "");
      await updateProjectNotesAction(projectId, notes);
      setSaved(true);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
      <NotesEditor name="notes" defaultValue={initialNotes} />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" pending={isSaving}>
          {isSaving ? "Saving…" : "Save notes"}
        </Button>
        {saved && !isSaving && <span className="text-xs text-muted">Saved.</span>}
      </div>
    </form>
  );
}
