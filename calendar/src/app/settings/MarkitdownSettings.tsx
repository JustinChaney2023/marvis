"use client";

import { useState } from "react";
import { testMarkitdownEndpointAction } from "../actions";
import Button from "../ui/Button";

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

/**
 * Document-conversion block of the AI settings form. Client-side only for
 * the connection test; the input keeps its `name` so the surrounding
 * server-action form submits it exactly like the other fields.
 *
 * No model or API key here, unlike transcription — markitdown is a
 * stateless local converter with nothing to authenticate against.
 */
export default function MarkitdownSettings({ markitdownUrl }: { markitdownUrl: string }) {
  const [url, setUrl] = useState(markitdownUrl);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testMarkitdownEndpointAction(url));
    } catch {
      setResult({ ok: false, error: "Test failed — check the server logs." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <span className="text-sm font-medium">Document conversion (PDF import)</span>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Lets the syllabus importer read PDFs, slides, and spreadsheets. Leave
        blank and .txt/.md/.docx still import as normal. Run the service with{" "}
        <code>docker compose up -d --build</code> in <code>markitdown/</code> —
        see <code>docs/markitdown-setup.md</code>.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Converter URL</span>
        <input
          name="markitdownUrl"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://100.x.x.x:8080"
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" onClick={handleTest} pending={testing}>
          Test connection
        </Button>
        {result?.ok && <span className="text-xs text-green-600 dark:text-green-400">Connected.</span>}
        {result && !result.ok && (
          <span className="text-xs text-amber-600 dark:text-amber-400">{result.error}</span>
        )}
      </div>
      <p className="text-xs text-zinc-400">
        Scanned PDFs and photos have no text to extract — this service reads
        embedded text, it does not perform OCR.
      </p>
    </div>
  );
}
