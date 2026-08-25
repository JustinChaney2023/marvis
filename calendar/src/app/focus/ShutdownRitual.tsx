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
      <Button type="button" variant="secondary" onClick={open} pending={isLoading} className="mt-6 self-start">
        {isLoading ? "Loading…" : "Shut down for the day"}
      </Button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-rule bg-surface p-4">
      <h2 className="font-serif text-lg text-ink">Today, wrapped</h2>

      <div className="mt-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
          Completed ({summary.completedToday.length})
        </p>
        {summary.completedToday.length === 0 ? (
          <p className="mt-1 text-xs text-muted">Nothing marked done today.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {summary.completedToday.map((t) => (
              <li key={t.id} className="text-sm text-ink-2 line-through">
                {t.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
          Still open ({summary.stillOpen.length})
        </p>
        {summary.stillOpen.length === 0 ? (
          <p className="mt-1 text-xs text-muted">Nothing left over — clean slate.</p>
        ) : pushed ? (
          <p className="mt-1 text-xs text-accent">
            Pushed to tomorrow.
          </p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-1">
              {summary.stillOpen.map((t) => (
                <li key={t.id} className="text-sm text-ink-2">
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
