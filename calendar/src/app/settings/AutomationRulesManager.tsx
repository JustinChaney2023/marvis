"use client";

import { useState } from "react";
import {
  createAutomationRuleAction,
  toggleAutomationRuleAction,
  deleteAutomationRuleAction,
} from "../actions";
import Button from "../ui/Button";

const STATUS_LABEL: Record<string, string> = {
  CREATED: "Created",
  ONGOING: "Ongoing",
  DELAYED: "Delayed",
  DONE: "Completed",
};

const ACTION_LABEL: Record<string, string> = {
  NOTIFY: "Send a notification",
  GENERATE_SUBTASKS: "Generate subtasks with AI",
  DRAFT_EMAIL: "Draft an email with AI",
  SET_PRIORITY_URGENT: "Set priority to Urgent",
};

export type AutomationRuleData = {
  id: string;
  triggerStatus: string;
  projectId: string | null;
  action: string;
  enabled: boolean;
};

export default function AutomationRulesManager({
  rules,
  projects,
}: {
  rules: AutomationRuleData[];
  projects: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => {
        const projectName = projects.find((p) => p.id === rule.projectId)?.name;
        return (
          <div
            key={rule.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-600"
          >
            <p className="min-w-0">
              When a task becomes{" "}
              <span className="font-medium">{STATUS_LABEL[rule.triggerStatus]}</span>
              {projectName && <> in <span className="font-medium">{projectName}</span></>}
              {" → "}
              <span className="font-medium">{ACTION_LABEL[rule.action]}</span>
            </p>
            <div className="flex items-center gap-2">
              <form action={toggleAutomationRuleAction.bind(null, rule.id, !rule.enabled)}>
                <button
                  type="submit"
                  className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
              </form>
              <form action={deleteAutomationRuleAction.bind(null, rule.id)}>
                <button
                  type="submit"
                  className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  Delete
                </button>
              </form>
            </div>
          </div>
        );
      })}
      {rules.length === 0 && (
        <p className="text-sm text-zinc-400">No automation rules yet.</p>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Add rule
        </button>
      ) : (
        <form
          action={async (formData) => {
            await createAutomationRuleAction(formData);
            setAdding(false);
          }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-600"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            When status becomes
            <select
              name="triggerStatus"
              defaultValue="DONE"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            In project (optional)
            <select
              name="projectId"
              defaultValue=""
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              <option value="">Any project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Then
            <select
              name="action"
              defaultValue="NOTIFY"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              {Object.entries(ACTION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit">Add</Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
