"use client";

import { useState } from "react";
import {
  disconnectGoogleAction,
  setDefaultGoogleAccountAction,
  renameGoogleAccountAction,
  listGoogleAccountCalendarsAction,
  setGoogleAccountCalendarAction,
} from "../actions";
import Button from "../ui/Button";
import SyncButton from "./SyncButton";

export type ManagedGoogleAccount = {
  id: string;
  email: string;
  label: string;
  isDefault: boolean;
  lastSyncedAt: Date | null;
  calendarId: string;
};

type GoogleCalendarOption = { id: string; summary: string; primary: boolean };

// Loaded on demand (a "Change calendar" click), not up front on page
// load — an extra Google API round-trip per connected account just to
// populate a picker nobody may ever open isn't worth the load-time cost.
function CalendarPicker({ account }: { account: ManagedGoogleAccount }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<GoogleCalendarOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    if (options) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = await listGoogleAccountCalendarsAction(account.id);
      if (!list) {
        setError("Couldn't load calendars for this account.");
        return;
      }
      setOptions(list);
    } finally {
      setIsLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={load}
        className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        Change calendar ({account.calendarId})
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {isLoading ? (
        <span className="text-zinc-400">Loading calendars…</span>
      ) : error ? (
        <span className="text-red-600 dark:text-red-400">{error}</span>
      ) : (
        <select
          defaultValue={account.calendarId}
          onChange={(e) => setGoogleAccountCalendarAction(account.id, e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800"
        >
          {options?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}
              {c.primary ? " (primary)" : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function GoogleAccountsManager({ accounts }: { accounts: ManagedGoogleAccount[] }) {
  return (
    <div className="mt-3 space-y-3">
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-600 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <input
                  defaultValue={account.label}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== account.label) renameGoogleAccountAction(account.id, value);
                  }}
                  className={`${inputClass} min-w-0 font-medium`}
                  aria-label={`Label for ${account.email}`}
                />
                {account.isDefault && (
                  <span className="flex-shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    Default
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {account.email} —{" "}
                {account.lastSyncedAt ? `synced ${account.lastSyncedAt.toLocaleString()}` : "never synced yet"}
              </p>
              <div className="mt-1">
                <CalendarPicker account={account} />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {!account.isDefault && (
                <form action={setDefaultGoogleAccountAction.bind(null, account.id)}>
                  <button
                    type="submit"
                    className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Set as default
                  </button>
                </form>
              )}
              <form action={disconnectGoogleAction.bind(null, account.id)}>
                <Button type="submit" variant="secondary">Disconnect</Button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <SyncButton />
        <a
          href="/api/google/connect"
          className="text-sm text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
        >
          Connect another Google account
        </a>
      </div>

      <p className="text-xs text-zinc-400">
        Syncs the last 7 days through the next 90 for every connected account.
        New events you create here export to the account marked "Default"
        unless you pick a different one on the event itself. Deletions sync
        both ways.
      </p>
    </div>
  );
}
