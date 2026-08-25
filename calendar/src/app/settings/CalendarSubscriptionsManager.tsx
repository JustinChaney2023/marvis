"use client";

import { useState } from "react";
import {
  addCalendarSubscriptionAction,
  syncCalendarSubscriptionAction,
  deleteCalendarSubscriptionAction,
} from "../actions";
import Button from "../ui/Button";

export type Subscription = {
  id: string;
  name: string;
  url: string;
  importAsTasks: boolean;
  lastFetchedAt: Date | null;
  lastError: string | null;
};

export default function CalendarSubscriptionsManager({
  subscriptions,
}: {
  subscriptions: Subscription[];
}) {
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await syncCalendarSubscriptionAction(id);
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {subscriptions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {subscriptions.map((sub) => (
            <li
              key={sub.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-rule px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{sub.name}</p>
                <p className="truncate text-xs text-muted font-mono">{sub.url}</p>
                {sub.lastError ? (
                  <p className="text-xs text-accent">{sub.lastError}</p>
                ) : (
                  <p className="text-xs text-muted">
                    {sub.lastFetchedAt
                      ? `Synced ${sub.lastFetchedAt.toLocaleString()}`
                      : "Not synced yet"}
                  </p>
                )}
                {sub.importAsTasks && (
                  <p className="text-xs text-accent">
                    Importing as schedulable tasks
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  pending={syncingId === sub.id}
                  onClick={() => handleSync(sub.id)}
                >
                  Sync
                </Button>
                <form action={deleteCalendarSubscriptionAction.bind(null, sub.id)}>
                  <Button type="submit" variant="danger">
                    Remove
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form action={addCalendarSubscriptionAction} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Name</span>
          <input
            type="text"
            name="name"
            placeholder="US Holidays"
            required
            className="w-40 rounded-lg border border-rule bg-surface px-2 py-2 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">ICS URL</span>
          <input
            type="url"
            name="url"
            placeholder="https://example.com/calendar.ics"
            required
            className="w-72 rounded-lg border border-rule bg-surface px-2 py-2 text-sm text-ink"
          />
        </label>
        <label className="flex max-w-xs cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" name="importAsTasks" className="mt-0.5" />
          <span className="text-muted">
            Create schedulable tasks (with auto-scheduled work time) instead
            of just showing on your calendar — good for an LMS assignment
            feed like Blackboard or Canvas.
          </span>
        </label>
        <Button type="submit">Subscribe</Button>
      </form>
    </div>
  );
}
