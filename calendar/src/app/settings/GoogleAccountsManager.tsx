"use client";

import {
  disconnectGoogleAction,
  setDefaultGoogleAccountAction,
  renameGoogleAccountAction,
} from "../actions";
import Button from "../ui/Button";
import SyncButton from "./SyncButton";

export type ManagedGoogleAccount = {
  id: string;
  email: string;
  label: string;
  isDefault: boolean;
  lastSyncedAt: Date | null;
};

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
