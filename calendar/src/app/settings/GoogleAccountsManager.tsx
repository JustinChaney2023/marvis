"use client";

import { useState } from "react";
import {
  disconnectGoogleAction,
  setDefaultGoogleAccountAction,
  renameGoogleAccountAction,
  listGoogleAccountCalendarsAction,
  addGoogleCalendarAction,
  removeGoogleCalendarAction,
  setDefaultGoogleCalendarAction,
} from "../actions";
import Button from "../ui/Button";
import SyncButton from "./SyncButton";

export type ManagedGoogleCalendar = {
  id: string;
  calendarId: string;
  summary: string;
  isDefault: boolean;
  lastSyncedAt: Date | null;
};

export type ManagedGoogleAccount = {
  id: string;
  email: string;
  label: string;
  isDefault: boolean;
  calendars: ManagedGoogleCalendar[];
};

type GoogleCalendarOption = { id: string; summary: string; primary: boolean };

// Loaded on demand (an "Add calendar" click), not up front on page load —
// an extra Google API round-trip per connected account just to populate a
// picker nobody may ever open isn't worth the load-time cost.
function AddCalendarPicker({ account }: { account: ManagedGoogleAccount }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<GoogleCalendarOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribedIds = new Set(account.calendars.map((c) => c.calendarId));

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
        className="text-xs text-ink-2 underline hover:text-ink"
      >
        + Add calendar
      </button>
    );
  }

  const addable = options?.filter((c) => !subscribedIds.has(c.id)) ?? [];

  return (
    <div className="flex items-center gap-2 text-xs">
      {isLoading ? (
        <span className="text-muted">Loading calendars…</span>
      ) : error ? (
        <span className="text-accent">{error}</span>
      ) : addable.length === 0 ? (
        <span className="text-muted">Every calendar on this account is already synced.</span>
      ) : (
        <select
          defaultValue=""
          onChange={(e) => {
            const chosen = addable.find((c) => c.id === e.target.value);
            if (!chosen) return;
            addGoogleCalendarAction(account.id, chosen.id, chosen.summary);
            setOpen(false);
          }}
          className="rounded-lg border border-rule bg-surface px-2 py-1"
        >
          <option value="" disabled>
            Pick a calendar to sync…
          </option>
          {addable.map((c) => (
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
  "rounded-lg border border-rule bg-surface px-2 py-1 text-sm transition-colors focus:border-accent focus:outline-none";

export default function GoogleAccountsManager({ accounts }: { accounts: ManagedGoogleAccount[] }) {
  return (
    <div className="mt-3 space-y-3">
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-col gap-2 rounded-lg border border-rule px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
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
                  <span className="flex-shrink-0 rounded-full bg-accent-wash px-2 py-0.5 text-[10px] font-medium text-accent">
                    Default
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-2">{account.email}</p>

              <ul className="mt-1.5 flex flex-col gap-1">
                {account.calendars.map((cal) => (
                  <li key={cal.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 truncate">{cal.summary}</span>
                    {cal.isDefault && (
                      <span className="flex-shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[9px] font-medium text-accent">
                        Default
                      </span>
                    )}
                    <span className="flex-shrink-0 text-ink-2">
                      {cal.lastSyncedAt ? `synced ${cal.lastSyncedAt.toLocaleString()}` : "never synced yet"}
                    </span>
                    {!cal.isDefault && (
                      <form action={setDefaultGoogleCalendarAction.bind(null, cal.id)}>
                        <button type="submit" className="text-ink-2 underline hover:text-ink">
                          Set as default
                        </button>
                      </form>
                    )}
                    {account.calendars.length > 1 && (
                      <form action={removeGoogleCalendarAction.bind(null, cal.id)}>
                        <button type="submit" className="text-ink-2 underline hover:text-ink">
                          Remove
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-1.5">
                <AddCalendarPicker account={account} />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {!account.isDefault && (
                <form action={setDefaultGoogleAccountAction.bind(null, account.id)}>
                  <button
                    type="submit"
                    className="text-xs text-ink-2 underline hover:text-ink"
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
          className="text-sm text-accent underline hover:text-accent-hover"
        >
          Connect another Google account
        </a>
      </div>

      <p className="text-xs text-muted">
        Syncs the last 7 days through the next 90 for every subscribed
        calendar. New events you create here export to the calendar marked
        &quot;Default&quot; (on the default account) unless you pick a different one
        on the event itself. Deletions sync both ways.
      </p>
    </div>
  );
}
