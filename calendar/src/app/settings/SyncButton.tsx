"use client";

import { useState } from "react";
import { syncGoogleCalendarAction } from "../actions";
import Button from "../ui/Button";

export default function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setResult(null);
    try {
      const r = await syncGoogleCalendarAction();
      const deletedNote = r.deleted > 0 ? `, removed ${r.deleted}` : "";
      setResult(`Synced — pushed ${r.exported}, pulled ${r.imported}${deletedNote}.`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={handleSync} pending={isSyncing}>
        {isSyncing ? "Syncing…" : "Sync now"}
      </Button>
      {result && <span className="text-sm text-zinc-500">{result}</span>}
    </div>
  );
}
