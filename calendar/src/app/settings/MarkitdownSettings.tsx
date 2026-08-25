"use client";

import { useState } from "react";
import { testMarkitdownEndpointAction } from "../actions";
import Button from "../ui/Button";

const inputClass =
  "rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none";

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
    <div className="flex flex-col gap-2 border-t border-rule pt-4">
      <span className="text-sm font-medium text-ink">Document conversion (PDF import)</span>
      <p className="text-xs text-muted">
        Lets the syllabus importer read PDFs, slides, and spreadsheets. Leave
        blank and .txt/.md/.docx still import as normal. Run the service with{" "}
        <code>docker compose up -d --build</code> in <code>markitdown/</code> —
        see <code>docs/markitdown-setup.md</code>.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Converter URL</span>
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
        {result?.ok && <span className="text-xs text-ink-2">Connected.</span>}
        {result && !result.ok && (
          <span className="text-xs text-accent">{result.error}</span>
        )}
      </div>
      <p className="text-xs text-muted">
        Scanned PDFs and photos have no text to extract — this service reads
        embedded text, it does not perform OCR.
      </p>
    </div>
  );
}
