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
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule p-3 text-sm"
          >
            <p className="min-w-0 text-ink-2">
              When a task becomes{" "}
              <span className="font-medium text-ink">{STATUS_LABEL[rule.triggerStatus]}</span>
              {projectName && <> in <span className="font-medium text-ink">{projectName}</span></>}
              {" → "}
              <span className="font-medium text-ink">{ACTION_LABEL[rule.action]}</span>
            </p>
            <div className="flex items-center gap-2">
              <form action={toggleAutomationRuleAction.bind(null, rule.id, !rule.enabled)}>
                <button
                  type="submit"
                  className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-rule-soft hover:text-ink"
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
              </form>
              <form action={deleteAutomationRuleAction.bind(null, rule.id)}>
                <button
                  type="submit"
                  className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-accent-wash hover:text-accent"
                >
                  Delete
                </button>
              </form>
            </div>
          </div>
        );
      })}
      {rules.length === 0 && (
        <p className="text-sm text-muted">No automation rules yet.</p>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-sm text-accent hover:underline"
        >
          + Add rule
        </button>
      ) : (
        <form
          action={async (formData) => {
            await createAutomationRuleAction(formData);
            setAdding(false);
          }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-rule p-3"
        >
          <label className="flex flex-col gap-1 text-xs text-muted">
            When status becomes
            <select
              name="triggerStatus"
              defaultValue="DONE"
              className="rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            In project (optional)
            <select
              name="projectId"
              defaultValue=""
              className="rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Any project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Then
            <select
              name="action"
              defaultValue="NOTIFY"
              className="rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
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
