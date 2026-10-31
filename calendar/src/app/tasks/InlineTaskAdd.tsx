"use client";

import { useRef, useState } from "react";
import { quickCaptureTask } from "../actions";
import { CapturePreview, type CaptureProject } from "../QuickCapture";
import { PlusIcon } from "../icons";
import Button from "../ui/Button";

/**
 * Always-visible "Add a task" bar at the top of the Tasks list — the
 * fastest path from a thought to a task: type, Enter, done. Uses the same
 * shorthand as the global quick-capture box, and files into the project
 * you're currently filtered to unless you #tag another.
 */
export default function InlineTaskAdd({
  projects,
  currentProjectId,
}: {
  projects: CaptureProject[];
  currentProjectId?: string;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || pending) return;
    setPending(true);
    try {
      const result = await quickCaptureTask(value, { defaultProjectId: currentProjectId ?? null });
      if (result.ok) {
        setValue("");
        setFlash(
          result.unmatchedProject
            ? `Added “${result.title}” — no project called “${result.unmatchedProject}”`
            : `Added “${result.title}”`,
        );
        setTimeout(() => setFlash(null), 2500);
      } else {
        setFlash(result.error);
      }
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 rounded-xl border border-rule bg-surface px-3 py-2 focus-within:border-accent">
      <div className="flex items-center gap-2">
        <PlusIcon className="h-4 w-4 flex-shrink-0 text-accent" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={currentProject ? `Add a task to ${currentProject.name}…` : "Add a task… e.g. essay draft fri #english 2h"}
          enterKeyHint="done"
          autoComplete="off"
          aria-label="Add a task"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-ink placeholder:text-muted focus:outline-none md:text-sm"
        />
        {value.trim() && (
          <Button type="submit" pending={pending} className="px-3 py-1.5 text-xs">
            Add
          </Button>
        )}
      </div>
      {(value.trim() || flash) && (
        <div className="pl-6">
          {flash && !value.trim() ? (
            <p className="py-1 text-xs text-ink-2">{flash}</p>
          ) : (
            <CapturePreview value={value} mode="task" projects={projects} fallbackProject={currentProject} />
          )}
        </div>
      )}
    </form>
  );
}
