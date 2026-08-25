"use client";

import { useState } from "react";
import {
  getShutdownSummaryAction,
  pushLeftoversToTomorrowAction,
} from "../actions";
import Button from "../ui/Button";
import type { ShutdownSummary } from "@/lib/shutdown";

export default function ShutdownRitual() {
  const [summary, setSummary] = useState<ShutdownSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [pushed, setPushed] = useState(false);

  const open = async () => {
    setIsLoading(true);
    try {
      setSummary(await getShutdownSummaryAction());
    } finally {
      setIsLoading(false);
    }
  };

  const handlePushLeftovers = async () => {
    if (!summary || summary.stillOpen.length === 0) return;
    setIsPushing(true);
    try {
      await pushLeftoversToTomorrowAction(summary.stillOpen.map((t) => t.id));
      setPushed(true);
    } finally {
      setIsPushing(false);
    }
  };

  if (!summary) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={isLoading}
        className="mt-6 self-start rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-all hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
      >
        {isLoading ? "Loading…" : "Shut down for the day"}
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
      <h2 className="text-sm font-semibold">Today, wrapped</h2>

      <div className="mt-3">
        <p className="text-xs font-medium text-zinc-500">
          Completed ({summary.completedToday.length})
        </p>
        {summary.completedToday.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-400">Nothing marked done today.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {summary.completedToday.map((t) => (
              <li key={t.id} className="text-sm text-zinc-700 line-through dark:text-zinc-300">
                {t.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-zinc-500">
          Still open ({summary.stillOpen.length})
        </p>
        {summary.stillOpen.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-400">Nothing left over — clean slate. 🎉</p>
        ) : pushed ? (
          <p className="mt-1 text-xs text-green-600 dark:text-green-400">
            Pushed to tomorrow.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {summary.stillOpen.map((t) => (
                <li key={t.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                  {t.title}
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <Button type="button" onClick={handlePushLeftovers} pending={isPushing}>
                {isPushing ? "Pushing…" : "Push all to tomorrow"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
