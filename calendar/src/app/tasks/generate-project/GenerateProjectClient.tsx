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
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

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
            <span className="text-zinc-500">Describe the project</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Launch the OmneHosting Q3 marketing site"
              className={inputClass}
            />
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
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
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
          Created project with {createdCount} task{createdCount === 1 ? "" : "s"}.
        </p>
      )}

      {rows && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Project name</span>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className={inputClass}
            />
          </label>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No tasks proposed.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => updateRow(i, { include: e.target.checked })}
                      className="mt-2.5 h-4 w-4"
                      aria-label="Include"
                    />
                    <input
                      value={row.title}
                      onChange={(e) => updateRow(i, { title: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  {row.notes && <p className="pl-6 text-xs text-zinc-400">{row.notes}</p>}
                </li>
              ))}
            </ul>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Assign every task to</span>
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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
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
