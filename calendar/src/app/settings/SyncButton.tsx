"use client";

import { useState } from "react";
import { syncGoogleCalendarAction } from "../actions";
import Button from "../ui/Button";

export default function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const handleSync = async () => {
    setIsSyncing(true);
    setResult(null);
    setErrors([]);
    try {
      const r = await syncGoogleCalendarAction();
      const deletedNote = r.deleted > 0 ? `, removed ${r.deleted}` : "";
      setResult(`Synced — pushed ${r.exported}, pulled ${r.imported}${deletedNote}.`);
      // These used to only ever reach the server console — a sync that
      // silently fails on every event (an expired token, a rejected
      // request) reported "pushed 0, pulled 0" indistinguishably from
      // one where there was genuinely nothing to do.
      setErrors(r.errors);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSync} pending={isSyncing}>
          {isSyncing ? "Syncing…" : "Sync now"}
        </Button>
        {result && <span className="text-sm text-ink-2">{result}</span>}
      </div>
      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-accent bg-accent-wash px-3 py-2 text-xs text-accent">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
