"use client";

import { useState } from "react";
import { createHabitAction, toggleHabitAction, deleteHabitAction } from "../actions";
import Button from "../ui/Button";

export type HabitData = {
  id: string;
  title: string;
  durationMin: number;
  timesPerWeek: number;
  enabled: boolean;
};

export default function HabitsManager({ habits }: { habits: HabitData[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {habits.map((habit) => (
        <div
          key={habit.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule p-3 text-sm"
        >
          <p>
            <span className="font-medium text-ink">{habit.title}</span>{" "}
            <span className="text-muted">
              — {habit.timesPerWeek}x/week, {habit.durationMin} min
            </span>
          </p>
          <div className="flex items-center gap-2">
            <form action={toggleHabitAction.bind(null, habit.id, !habit.enabled)}>
              <button
                type="submit"
                className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-rule-soft hover:text-ink"
              >
                {habit.enabled ? "Disable" : "Enable"}
              </button>
            </form>
            <form action={deleteHabitAction.bind(null, habit.id)}>
              <button
                type="submit"
                className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-accent-wash hover:text-accent"
              >
                Delete
              </button>
            </form>
          </div>
        </div>
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
