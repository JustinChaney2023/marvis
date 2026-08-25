"use client";

import { useState } from "react";
import { scanHardwareAction, testTranscribeEndpointAction } from "../actions";
import Button from "../ui/Button";

const inputClass =
  "rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none";

type Props = {
  transcribeUrl: string;
  transcribeModel: string;
  hasApiKey: boolean;
  /** Measured seconds-of-audio per second-of-wall-clock, or null if nothing measurable has run yet. */
  realtimeFactor: number | null;
};

/** "8× realtime — a 50-minute lecture takes about 6 minutes." */
function describeThroughput(factor: number): string {
  const lectureMin = Math.max(1, Math.round(50 / factor));
  const rate = factor >= 10 ? Math.round(factor) : Math.round(factor * 10) / 10;
  return `Your endpoint transcribes at about ${rate}× realtime — a 50-minute lecture takes roughly ${lectureMin} minute${
    lectureMin === 1 ? "" : "s"
  }.`;
}

/**
 * The transcription block of the AI settings form. A client component only
 * for the interactive parts (discover models, test the connection, scan
 * local hardware) — the inputs keep their original `name`s so the
 * surrounding server-action form still submits exactly as before.
 */
export default function TranscriptionSettings({
  transcribeUrl,
  transcribeModel,
  hasApiKey,
  realtimeFactor,
}: Props) {
  const [url, setUrl] = useState(transcribeUrl);
  const [model, setModel] = useState(transcribeModel);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [isLocal, setIsLocal] = useState(false);
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ suggestion: string; reason: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestError(null);
    setScanResult(null);
    try {
      const result = await testTranscribeEndpointAction(url, apiKey);
      setModels(result.models);
      setIsLocal(result.isLocal);
      setTestError(result.error);
      setTested(true);
    } catch {
      setTestError("Couldn't run the test.");
    } finally {
      setTesting(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      setScanResult(await scanHardwareAction(models));
    } catch {
      setScanResult(null);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      <p className="text-sm font-medium text-ink-2">
        Transcription{" "}
        <span className="font-normal text-muted">(for lecture/meeting recordings)</span>
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Speech-to-text URL</span>
        <input
          type="url"
          name="transcribeUrl"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://100.x.x.x:8000/v1 or https://api.openai.com/v1"
          className={inputClass}
        />
        <span className="text-xs text-muted">
          An OpenAI-compatible base URL exposing{" "}
          <code className="rounded bg-rule-soft px-1 py-0.5">
            /audio/transcriptions
          </code>
          . Anything implementing it works — a local{" "}
          <code className="rounded bg-rule-soft px-1 py-0.5">
            faster-whisper-server
          </code>
          , a <code className="rounded bg-rule-soft px-1 py-0.5">whisper.cpp</code>{" "}
          server, or OpenAI&apos;s hosted Whisper. Claude has no speech-to-text endpoint, so this is
          configured separately from the model above.
        </span>
        <span className="text-xs text-muted">
          Running whisper on another machine over Tailscale:{" "}
          <code className="rounded bg-rule-soft px-1 py-0.5">
            http://100.x.x.x:8000/v1
          </code>{" "}
          with model{" "}
          <code className="rounded bg-rule-soft px-1 py-0.5">
            Systran/faster-whisper-small
          </code>{" "}
          and no API key. Hosted instead:{" "}
          <code className="rounded bg-rule-soft px-1 py-0.5">
            https://api.openai.com/v1
          </code>{" "}
          with <code className="rounded bg-rule-soft px-1 py-0.5">whisper-1</code>{" "}
          and a key.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" pending={testing} onClick={handleTest}>
          {tested ? "Refresh models" : "Test connection"}
        </Button>
        {tested && !testError && (
          <span className="text-xs text-ink-2">
            Connected — {models.length} model{models.length === 1 ? "" : "s"} available
            {isLocal ? " (running on this machine)" : ""}.
          </span>
        )}
      </div>
      {testError && (
        <span className="text-xs text-accent">
          {testError} You can still enter a model name manually and save.
        </span>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Transcription model</span>
        {models.length > 0 && (
          <select
            value={models.includes(model) ? model : ""}
            onChange={(e) => e.target.value && setModel(e.target.value)}
            aria-label="Discovered models"
            className={inputClass}
          >
            <option value="">Pick from what the endpoint reported…</option>
            {models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )}
        {/* Always editable: not every server implements /v1/models, and a
            model id the server accepts has to stay enterable regardless. */}
        <input
          type="text"
          name="transcribeModel"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Systran/faster-whisper-small or whisper-1"
          className={inputClass}
        />
        <span className="text-xs text-muted">
          Bigger is more accurate but slower. Test the connection to list what your endpoint
          actually serves.
        </span>
      </label>

      {tested && (
        <div className="rounded-lg border border-rule p-3 text-xs">
          {isLocal ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" pending={scanning} onClick={handleScan}>
                  Scan this machine
                </Button>
                <span className="text-muted">
                  Transcription runs here, so this machine&apos;s hardware decides what it can keep
                  up with.
                </span>
              </div>
              {scanResult && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-ink-2">{scanResult.reason}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted">
                      Suggested:{" "}
                      <code className="rounded bg-rule-soft px-1 py-0.5">
                        {scanResult.suggestion}
                      </code>
                    </span>
                    <button
                      type="button"
                      onClick={() => setModel(scanResult.suggestion)}
                      className="text-accent underline"
                    >
                      Use this
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-muted">
              Transcription runs on a different machine, so a hardware scan here wouldn&apos;t
              describe the machine doing the work. Pick a model size that fits{" "}
              <em>that</em> machine&apos;s GPU.
            </span>
          )}
        </div>
      )}

      {realtimeFactor !== null && (
        <p className="text-xs text-muted">
          {describeThroughput(realtimeFactor)}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">
          API key{" "}
          <span className="text-muted">(leave blank for a local whisper server with no auth)</span>
        </span>
        <input
          type="password"
          name="transcribeApiKey"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? "•••••••• (saved — leave blank to keep)" : "sk-..."}
          autoComplete="off"
          className={inputClass}
        />
        {hasApiKey && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" name="clearTranscribeApiKey" />
            Clear saved key
          </label>
        )}
      </label>
    </div>
  );
}
