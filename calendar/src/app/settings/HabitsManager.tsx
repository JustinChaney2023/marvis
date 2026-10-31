"use client";

import { useState } from "react";
import {
  createHabitAction,
  toggleHabitAction,
  deleteHabitAction,
  scheduleHabitNowAction,
  updateHabitNotesAction,
} from "../actions";
import Button from "../ui/Button";
import { ConfirmForm } from "../ui/ConfirmForm";

export type HabitCadence = "WEEKLY" | "INTERVAL" | "MANUAL";

export type HabitData = {
  id: string;
  title: string;
  durationMin: number;
  cadence: string;
  timesPerWeek: number;
  intervalDays: number | null;
  notes: string | null;
  enabled: boolean;
};

function cadenceLabel(habit: HabitData): string {
  if (habit.cadence === "INTERVAL") return `every ${habit.intervalDays ?? "?"} days`;
  if (habit.cadence === "MANUAL") return "as needed";
  return `${habit.timesPerWeek}x/week`;
}

function HabitRow({ habit }: { habit: HabitData }) {
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rule p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-medium text-ink">{habit.title}</span>{" "}
          <span className="text-muted">
            — {cadenceLabel(habit)}, {habit.durationMin} min
          </span>
        </p>
        <div className="flex items-center gap-2">
          {habit.cadence === "MANUAL" && habit.enabled && (
            <form action={scheduleHabitNowAction.bind(null, habit.id)}>
              <button
                type="submit"
                className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-rule-soft hover:text-ink"
              >
                Schedule now
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-rule-soft hover:text-ink"
          >
            Notes
          </button>
          <form action={toggleHabitAction.bind(null, habit.id, !habit.enabled)}>
            <button
              type="submit"
              className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-rule-soft hover:text-ink"
            >
              {habit.enabled ? "Disable" : "Enable"}
            </button>
          </form>
          <ConfirmForm message="Delete this habit?" action={deleteHabitAction.bind(null, habit.id)}>
            <button
              type="submit"
              className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-accent-wash hover:text-accent"
            >
              Delete
            </button>
          </ConfirmForm>
        </div>
      </div>
      {notesOpen && (
        <form
          action={async (formData) => {
            await updateHabitNotesAction(habit.id, formData);
          }}
          className="flex flex-col items-end gap-2"
        >
          <textarea
            name="notes"
            rows={6}
            defaultValue={habit.notes ?? ""}
            placeholder="Plan, splits, protocol — copied onto every scheduled occurrence's own notes."
            className="w-full rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
          />
          <Button type="submit">Save notes</Button>
        </form>
      )}
    </div>
  );
}

export default function HabitsManager({ habits }: { habits: HabitData[] }) {
  const [adding, setAdding] = useState(false);
  const [cadence, setCadence] = useState<HabitCadence>("WEEKLY");

  return (
    <div className="flex flex-col gap-3">
      {habits.map((habit) => (
        <HabitRow key={habit.id} habit={habit} />
      ))}
      {habits.length === 0 && <p className="text-sm text-muted">No habits yet.</p>}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-sm text-accent hover:underline"
        >
          + Add habit
        </button>
      ) : (
        <form
          action={async (formData) => {
            await createHabitAction(formData);
            setAdding(false);
            setCadence("WEEKLY");
          }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-rule p-3"
        >
          <label className="flex flex-col gap-1 text-xs text-muted">
            Title
            <input
              name="title"
              required
              placeholder="e.g. Exercise"
              className="w-40 rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Duration (min)
            <input
              name="durationMin"
              type="number"
              min={5}
              max={480}
              step={5}
              defaultValue={30}
              className="w-24 rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Frequency
            <select
              name="cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as HabitCadence)}
              className="w-32 rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="WEEKLY">Times per week</option>
              <option value="INTERVAL">Every N days</option>
              <option value="MANUAL">As needed</option>
            </select>
          </label>
          {cadence === "WEEKLY" && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Times per week
              <input
                name="timesPerWeek"
                type="number"
                min={1}
                max={14}
                defaultValue={3}
                className="w-24 rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
          )}
          {cadence === "INTERVAL" && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Every N days
              <input
                name="intervalDays"
                type="number"
                min={1}
                max={30}
                defaultValue={2}
                className="w-24 rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Notes
            <textarea
              name="notes"
              rows={2}
              placeholder="Plan, splits, protocol (optional)"
              className="w-56 rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink"
            />
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
