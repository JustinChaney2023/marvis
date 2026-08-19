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
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-600"
        >
          <p>
            <span className="font-medium">{habit.title}</span>{" "}
            <span className="text-zinc-500">
              — {habit.timesPerWeek}x/week, {habit.durationMin} min
            </span>
          </p>
          <div className="flex items-center gap-2">
            <form action={toggleHabitAction.bind(null, habit.id, !habit.enabled)}>
              <button
                type="submit"
                className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              >
                {habit.enabled ? "Disable" : "Enable"}
              </button>
            </form>
            <form action={deleteHabitAction.bind(null, habit.id)}>
              <button
                type="submit"
                className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                Delete
              </button>
            </form>
          </div>
        </div>
      ))}
      {habits.length === 0 && <p className="text-sm text-zinc-400">No habits yet.</p>}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Add habit
        </button>
      ) : (
        <form
          action={async (formData) => {
            await createHabitAction(formData);
            setAdding(false);
          }}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-600"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Title
            <input
              name="title"
              required
              placeholder="e.g. Exercise"
              className="w-40 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Duration (min)
            <input
              name="durationMin"
              type="number"
              min={5}
              max={480}
              step={5}
              defaultValue={30}
              className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Times per week
            <input
              name="timesPerWeek"
              type="number"
              min={1}
              max={14}
              defaultValue={3}
              className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
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
