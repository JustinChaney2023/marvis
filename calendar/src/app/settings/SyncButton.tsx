"use client";

import { useState } from "react";
import { syncGoogleCalendarAction } from "../actions";

export default function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setResult(null);
    try {
      const r = await syncGoogleCalendarAction();
      setResult(`Synced — pushed ${r.exported}, pulled ${r.imported}.`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleSync}
        disabled={isSyncing}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      >
        {isSyncing ? "Syncing…" : "Sync now"}
      </button>
      {result && <span className="text-sm text-zinc-500">{result}</span>}
    </div>
  );
}
