"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  extractSyllabusDatesAction,
  importSyllabusTasksAction,
  type SyllabusTaskInput,
} from "../syllabusActions";
import Button from "../../ui/Button";

type Project = { id: string; name: string };
type Assignee = { id: string; name: string; type: "HUMAN" | "AI" };

type ReviewRow = {
  title: string;
  dueDateYMD: string | null;
  notes: string | null;
  include: boolean;
};

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function SyllabusImportClient({
  projects,
  assignees,
}: {
  projects: Project[];
  assignees: Assignee[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [termStart, setTermStart] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const handleExtract = async () => {
    setIsExtracting(true);
    setError(null);
    setImportedCount(null);
    try {
      const result = await extractSyllabusDatesAction(text, termStart || null);
      if (!result.ok) {
        setError(result.error);
        setRows(null);
        return;
      }
      setRows(
        result.items.map((item) => ({
          title: item.title,
          dueDateYMD: item.dueDate,
          notes: item.notes,
          include: true,
        })),
      );
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsExtracting(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? null);
  };

  const handleImport = async () => {
    if (!rows) return;
    setIsImporting(true);
    setError(null);
    try {
      const items: SyllabusTaskInput[] = rows
        .filter((r) => r.include)
        .map((r) => ({ title: r.title, dueDateYMD: r.dueDateYMD }));
      const result = await importSyllabusTasksAction(items, projectId || null, assigneeId || null);
      setImportedCount(result.created);
      setRows(null);
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating tasks. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      {!rows && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Syllabus text</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="Paste the syllabus here…"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">
              Term start date <span className="text-zinc-400">(optional — helps resolve "Week 3" style dates)</span>
            </span>
            <input
              type="date"
              value={termStart}
              onChange={(e) => setTermStart(e.target.value)}
              className={`${inputClass} max-w-xs`}
            />
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          <div>
            <Button
              type="button"
              onClick={handleExtract}
              disabled={!text.trim()}
              pending={isExtracting}
            >
              {isExtracting ? "Extracting…" : "Extract dates"}
            </Button>
          </div>
        </>
      )}

      {importedCount !== null && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
          Created {importedCount} task{importedCount === 1 ? "" : "s"}.
        </p>
      )}

      {rows && (
        <>
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No deliverables found in that text.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
                >
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
                    className={`${inputClass} min-w-[10rem] flex-[2]`}
                  />
                  <input
                    type="date"
                    value={row.dueDateYMD ?? ""}
                    onChange={(e) => updateRow(i, { dueDateYMD: e.target.value || null })}
                    className={`${inputClass} flex-1`}
                  />
                  {row.notes && !row.dueDateYMD && (
                    <p className="w-full text-xs text-amber-600 dark:text-amber-400">
                      {row.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Project</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Assign to</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.type === "AI" ? " (AI)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setRows(null)} disabled={isImporting}>
              Back
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={rows.every((r) => !r.include)}
              pending={isImporting}
            >
              {isImporting ? "Adding…" : `Add ${rows.filter((r) => r.include).length} task${rows.filter((r) => r.include).length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
