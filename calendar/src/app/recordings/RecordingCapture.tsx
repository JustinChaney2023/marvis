"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createRecordingAction } from "../actions";
import { formatDuration, pickRecorderMimeType } from "@/lib/recordingFormat";
import Button from "../ui/Button";

type Attach = { eventId?: string | null; projectId?: string | null };

type Props = Attach & {
  /** Shown as the default title, e.g. the class this is being recorded for. */
  defaultTitle?: string;
  /** Recording policy from the course syllabus, surfaced before capture starts. */
  policy?: string | null;
};

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

// Flush a blob every few seconds instead of accumulating one giant buffer
// at stop(). Bounds memory on an hour-long recording, and means a crash
// leaves the chunks captured so far rather than nothing.
const TIMESLICE_MS = 5000;

export default function RecordingCapture({ eventId, projectId, defaultTitle, policy }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isCapturing = state !== "idle";

  // Elapsed clock. The single most important readout on screen: for a
  // 50-minute lecture, "is this still going?" is the only question.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Losing a lecture to a stray tab close is the worst failure this
  // feature has, so make the browser ask first.
  useEffect(() => {
    if (!isCapturing) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isCapturing]);

  /** Upload the audio, then register it — the shared tail of both capture paths. */
  const submit = async (blob: Blob, filename: string, mimeType: string) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", new File([blob], filename, { type: mimeType }));
      const res = await fetch("/api/uploads/recordings", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      const result = await createRecordingAction({
        title: title.trim() || defaultTitle || "Recording",
        audioPath: data.storedPath,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        eventId: eventId ?? null,
        projectId: projectId ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle(defaultTitle ?? "");
      setElapsed(0);
      router.refresh();
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setError(null);
    const mimeType = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      setError("This browser can't record any audio format this app accepts. Upload a file instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "Microphone access was denied. Allow it for this site in your browser's address-bar permissions, then try again.",
      );
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      // Release the mic — otherwise the browser's recording indicator
      // stays lit after we've stopped, which is exactly the kind of
      // ambiguity a recording UI must not have.
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      setState("idle");
      if (blob.size > 0) {
        void submit(blob, `recording.${mimeType.includes("mp4") ? "m4a" : "webm"}`, mimeType);
      }
    };
    recorder.start(TIMESLICE_MS);
    recorderRef.current = recorder;
    setElapsed(0);
    setState("recording");
  };

  const stop = () => recorderRef.current?.stop();
  const pause = () => {
    recorderRef.current?.pause();
    setState("paused");
  };
  const resume = () => {
    recorderRef.current?.resume();
    setState("recording");
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
      {policy && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="font-medium">Recording policy for this course:</span> {policy}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={defaultTitle || "Lecture, meeting, …"}
          disabled={isCapturing}
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {state === "idle" ? (
          <Button type="button" onClick={start} disabled={busy}>
            Start recording
          </Button>
        ) : (
          <>
            <span
              className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
              role="status"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full bg-red-600 ${state === "recording" ? "animate-pulse" : ""}`}
                aria-hidden
              />
              {state === "recording" ? "Recording" : "Paused"} — {formatDuration(elapsed)}
            </span>
            {state === "recording" ? (
              <Button type="button" variant="outline" onClick={pause}>
                Pause
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={resume}>
                Resume
              </Button>
            )}
            <Button type="button" onClick={stop}>
              Stop &amp; transcribe
            </Button>
          </>
        )}

        {!isCapturing && (
          <>
            <span className="text-xs text-zinc-400">or</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) {
                  if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
                  void submit(file, file.name, file.type);
                }
              }}
              className="max-w-full text-sm text-zinc-500 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-700 dark:file:text-zinc-200 dark:hover:file:bg-zinc-600"
            />
          </>
        )}
      </div>

      {busy && <span className="text-xs text-zinc-500">Uploading…</span>}
      {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}

      <p className="text-xs text-zinc-400">
        For a long lecture, recording on your phone and uploading the file here is more reliable — a
        backgrounded or locked device can suspend in-browser recording partway through.
      </p>
    </div>
  );
}
