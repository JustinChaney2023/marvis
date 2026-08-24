"use client";

import { useState } from "react";
import { scanHardwareAction, testTranscribeEndpointAction } from "../actions";
import Button from "../ui/Button";

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

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
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Transcription{" "}
        <span className="font-normal text-zinc-400">(for lecture/meeting recordings)</span>
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Speech-to-text URL</span>
        <input
          type="url"
          name="transcribeUrl"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://100.x.x.x:8000/v1 or https://api.openai.com/v1"
          className={inputClass}
        />
        <span className="text-xs text-zinc-400">
          An OpenAI-compatible base URL exposing{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">
            /audio/transcriptions
          </code>
          . Anything implementing it works — a local{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">
            faster-whisper-server
          </code>
          , a <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">whisper.cpp</code>{" "}
          server, or OpenAI&apos;s hosted Whisper. Claude has no speech-to-text endpoint, so this is
          configured separately from the model above.
        </span>
        <span className="text-xs text-zinc-400">
          Running whisper on another machine over Tailscale:{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">
            http://100.x.x.x:8000/v1
          </code>{" "}
          with model{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">
            Systran/faster-whisper-small
          </code>{" "}
          and no API key. Hosted instead:{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">
            https://api.openai.com/v1
          </code>{" "}
          with <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">whisper-1</code>{" "}
          and a key.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" pending={testing} onClick={handleTest}>
          {tested ? "Refresh models" : "Test connection"}
        </Button>
        {tested && !testError && (
          <span className="text-xs text-green-600 dark:text-green-400">
            Connected — {models.length} model{models.length === 1 ? "" : "s"} available
            {isLocal ? " (running on this machine)" : ""}.
          </span>
        )}
      </div>
      {testError && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          {testError} You can still enter a model name manually and save.
        </span>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Transcription model</span>
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
        <span className="text-xs text-zinc-400">
          Bigger is more accurate but slower. Test the connection to list what your endpoint
          actually serves.
        </span>
      </label>

      {tested && (
        <div className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-700">
          {isLocal ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" pending={scanning} onClick={handleScan}>
                  Scan this machine
                </Button>
                <span className="text-zinc-400">
                  Transcription runs here, so this machine&apos;s hardware decides what it can keep
                  up with.
                </span>
              </div>
              {scanResult && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-zinc-600 dark:text-zinc-300">{scanResult.reason}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-zinc-500">
                      Suggested:{" "}
                      <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">
                        {scanResult.suggestion}
                      </code>
                    </span>
                    <button
                      type="button"
                      onClick={() => setModel(scanResult.suggestion)}
                      className="text-indigo-600 underline dark:text-indigo-400"
                    >
                      Use this
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-zinc-400">
              Transcription runs on a different machine, so a hardware scan here wouldn&apos;t
              describe the machine doing the work. Pick a model size that fits{" "}
              <em>that</em> machine&apos;s GPU.
            </span>
          )}
        </div>
      )}

      {realtimeFactor !== null && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {describeThroughput(realtimeFactor)}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">
          API key{" "}
          <span className="text-zinc-400">(leave blank for a local whisper server with no auth)</span>
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
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input type="checkbox" name="clearTranscribeApiKey" />
            Clear saved key
          </label>
        )}
      </label>
    </div>
  );
}
