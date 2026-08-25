"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  generateProjectPlanAction,
  createProjectFromPlanAction,
  type GeneratedTaskInput,
} from "./projectActions";
import Button from "../../ui/Button";

type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };

type ReviewRow = { title: string; notes: string | null; include: boolean };

const inputClass =
  "w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none";

export default function GenerateProjectClient({ assignees }: { assignees: Assignee[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setCreatedCount(null);
    try {
      const result = await generateProjectPlanAction(prompt);
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        return;
      }
      setProjectName(result.projectName);
      setRows(result.tasks.map((t) => ({ title: t.title, notes: t.notes, include: true })));
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null);
  };

  const handleCreate = async () => {
    if (!rows) return;
    setIsCreating(true);
    setError(null);
    try {
      const items: GeneratedTaskInput[] = rows
        .filter((r) => r.include)
        .map((r) => ({ title: r.title, notes: r.notes }));
      const result = await createProjectFromPlanAction(projectName, items, assigneeId || null);
      setCreatedCount(result.created);
      setRows(null);
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating the project. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {!rows && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Describe the project</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Launch the OmneHosting Q3 marketing site"
              className={inputClass}
            />
          </label>
          {error && (
            <p className="rounded-lg border border-accent bg-accent-wash px-3 py-2 text-sm text-accent">
              {error}
            </p>
          )}
          <div>
            <Button type="button" onClick={handleGenerate} disabled={!prompt.trim()} pending={isGenerating}>
              {isGenerating ? "Thinking…" : "Generate project"}
            </Button>
          </div>
        </>
      )}

      {createdCount !== null && (
        <p className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink-2">
          Created project with {createdCount} task{createdCount === 1 ? "" : "s"}.
        </p>
      )}

      {rows && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Project name</span>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className={inputClass}
            />
          </label>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-rule py-6 text-center text-sm text-muted">
              No tasks proposed.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-1 rounded-xl border border-rule bg-surface p-3"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => updateRow(i, { include: e.target.checked })}
                      className="mt-2.5 h-4 w-4 accent-accent"
                      aria-label="Include"
                    />
                    <input
                      value={row.title}
                      onChange={(e) => updateRow(i, { title: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  {row.notes && <p className="pl-6 text-xs text-muted">{row.notes}</p>}
                </li>
              ))}
            </ul>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Assign every task to</span>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={`${inputClass} max-w-xs`}>
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.type === "AI" ? " (AI)" : ""}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="rounded-lg border border-accent bg-accent-wash px-3 py-2 text-sm text-accent">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setRows(null)} disabled={isCreating}>
              Back
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={!projectName.trim() || rows.every((r) => !r.include)}
              pending={isCreating}
            >
              {isCreating
                ? "Creating…"
                : `Create project with ${rows.filter((r) => r.include).length} task${rows.filter((r) => r.include).length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
