"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createRecordingAction, summarizeStepOutAction } from "../actions";
import { formatDuration, pickRecorderMimeType } from "@/lib/recordingFormat";
import { getLocalWhisper, sliceSegments } from "@/lib/localWhisper";
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

type UploadResult = { storedPath: string; mimeType: string; sizeBytes: number };

// fetch() has no upload-progress event — XHR is the only way to report
// bytes-sent for a large file without a streaming request body.
function uploadWithProgress(body: FormData, onProgress: (pct: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/recordings");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: { error?: string } & Partial<UploadResult> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // fall through to status-based error below
      }
      // A 2xx with a body that didn't parse, or parsed but wasn't the
      // shape we expect (a proxy/CDN returning a 200 HTML page, say),
      // must not resolve — storedPath: undefined would sail straight
      // into createRecordingAction otherwise.
      if (xhr.status >= 200 && xhr.status < 300 && data.storedPath) resolve(data as UploadResult);
      else reject(new Error(data.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
    xhr.send(body);
  });
}

export default function RecordingCapture({ eventId, projectId, defaultTitle, policy }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rough, local, in-browser live captions (see src/lib/localWhisper.ts) —
  // never leave the browser, purely to answer "what did I just miss."
  const [caption, setCaption] = useState("");
  const [captionStatus, setCaptionStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [stepOutAt, setStepOutAt] = useState<number | null>(null);
  const [stepOutBusy, setStepOutBusy] = useState(false);
  const [stepOutSummary, setStepOutSummary] = useState<string | null>(null);
  const [stepOutError, setStepOutError] = useState<string | null>(null);

  // Questions typed in live — answered from the transcript once it exists
  // (see answerQuestions in src/lib/recordings.ts). Kept here only as the
  // asked list; answers come back later via the recordings list detail view.
  const [questionText, setQuestionText] = useState("");
  const [askedQuestions, setAskedQuestions] = useState<{ atSec: number; text: string }[]>([]);
  // recorder.onstop is bound once per start() call and outlives every
  // re-render in between (each "Ask" click re-renders), so submit() must
  // read the live list from a ref rather than the askedQuestions state
  // closure it was created with — otherwise questions asked after the
  // first render of a recording would silently vanish on stop.
  const askedQuestionsRef = useRef<{ atSec: number; text: string }[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const unsubscribeCaptionRef = useRef<(() => void) | null>(null);

  const isCapturing = state !== "idle";

  // Elapsed clock. The single most important readout on screen: for a
  // 50-minute lecture, "is this still going?" is the only question.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Losing a lecture to a stray tab close is the worst failure this
  // feature has, so make the browser ask first — covering the upload too:
  // closing mid-upload loses the recorded blob just as completely as
  // closing mid-capture, and isCapturing alone is false by then.
  useEffect(() => {
    if (!isCapturing && !busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isCapturing, busy]);

  // The captioner reports readiness async (first model load can take a
  // few seconds); poll rather than plumb another callback through for
  // one status flag.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setCaptionStatus(getLocalWhisper().getStatus()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const stopCaptioning = () => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    unsubscribeCaptionRef.current?.();
    unsubscribeCaptionRef.current = null;
  };

  useEffect(() => stopCaptioning, []);

  /** Upload the audio, then register it — the shared tail of both capture paths. */
  const submit = async (blob: Blob, filename: string, mimeType: string) => {
    setBusy(true);
    setUploadPct(0);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", new File([blob], filename, { type: mimeType }));
      const data = await uploadWithProgress(body, setUploadPct);
      const result = await createRecordingAction({
        title: title.trim() || defaultTitle || "Recording",
        audioPath: data.storedPath,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        eventId: eventId ?? null,
        projectId: projectId ?? null,
        questions: askedQuestionsRef.current,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle(defaultTitle ?? "");
      setElapsed(0);
      askedQuestionsRef.current = [];
      setAskedQuestions([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      setUploadPct(null);
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
      stopCaptioning();
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
    setCaption("");
    setCaptionStatus("loading");
    setStepOutAt(null);
    setStepOutSummary(null);
    setStepOutError(null);
    askedQuestionsRef.current = [];
    setAskedQuestions([]);
    setQuestionText("");
    startCaptioning(stream);
  };

  const askQuestion = () => {
    const text = questionText.trim();
    if (!text) return;
    askedQuestionsRef.current = [...askedQuestionsRef.current, { atSec: elapsed, text }];
    setAskedQuestions(askedQuestionsRef.current);
    setQuestionText("");
  };

  /**
   * A second, parallel consumer of the same mic stream feeding the local
   * whisper captioner (src/lib/localWhisper.ts) — entirely separate from
   * the MediaRecorder above, which still drives the real upload/transcribe
   * pipeline unchanged. ScriptProcessorNode is deprecated but needs no
   * extra worklet file and works everywhere; captioning is best-effort,
   * so that trade is fine here.
   * ponytail: swap for AudioWorkletNode if browsers ever actually drop
   * ScriptProcessorNode.
   */
  const startCaptioning = (stream: MediaStream) => {
    const whisper = getLocalWhisper();
    whisper.reset();
    unsubscribeCaptionRef.current = whisper.onSegment((segment) => setCaption(segment.text));

    try {
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      // Route through a silent gain node rather than straight to
      // destination — ScriptProcessorNode only fires once connected
      // somewhere in the graph, but playing the mic back out loud would
      // be an obvious, unwanted echo.
      const silence = audioCtx.createGain();
      silence.gain.value = 0;
      source.connect(processor);
      processor.connect(silence);
      silence.connect(audioCtx.destination);
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        whisper.pushAudio(new Float32Array(input), audioCtx.sampleRate);
      };
      audioCtxRef.current = audioCtx;
      processorRef.current = processor;
    } catch {
      setCaptionStatus("unavailable");
    }
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

  /** First press marks the moment you step away; second press summarizes what the rough captions caught while you were gone. */
  const stepOut = () => {
    if (stepOutAt === null) {
      setStepOutAt(elapsed);
      setStepOutSummary(null);
      setStepOutError(null);
      return;
    }
    const away = sliceSegments(getLocalWhisper().getSegments(), stepOutAt, elapsed)
      .map((s) => s.text)
      .join(" ");
    setStepOutAt(null);
    setStepOutBusy(true);
    void summarizeStepOutAction(away)
      .then((result) => {
        if (result.ok) setStepOutSummary(result.summary);
        else setStepOutError(result.error);
      })
      .finally(() => setStepOutBusy(false));
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
            {state === "recording" && (
              <Button type="button" variant="outline" onClick={stepOut}>
                {stepOutAt === null ? "Step out" : "I'm back"}
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

      {state === "recording" && (
        <p className="truncate text-xs text-zinc-400" aria-live="polite">
          {captionStatus === "loading" && !caption && "Loading local captions…"}
          {captionStatus === "unavailable" && "Local captions unavailable — run `npm run setup:whisper` if this is a dev machine."}
          {caption}
        </p>
      )}

      {state === "recording" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  askQuestion();
                }
              }}
              placeholder="Type a question — answered from the transcript once it's ready…"
              className={inputClass}
            />
            <Button type="button" variant="outline" onClick={askQuestion} disabled={!questionText.trim()}>
              Ask
            </Button>
          </div>
          {askedQuestions.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-zinc-500">
              {askedQuestions.map((q, i) => (
                <li key={i}>
                  [{formatDuration(q.atSec)}] {q.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stepOutAt !== null && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Stepped out at {formatDuration(stepOutAt)} — press &quot;I&apos;m back&quot; for a catch-up note.
        </p>
      )}
      {stepOutBusy && <span className="text-xs text-zinc-500">Summarizing what you missed…</span>}
      {stepOutSummary && (
        <p className="flex items-start justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
          <span>{stepOutSummary}</span>
          <button
            type="button"
            onClick={() => setStepOutSummary(null)}
            className="shrink-0 text-indigo-500 hover:text-indigo-700 dark:text-indigo-300"
            aria-label="Dismiss"
          >
            ×
          </button>
        </p>
      )}
      {stepOutError && <span className="text-xs text-amber-600 dark:text-amber-400">{stepOutError}</span>}

      {busy && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">
            {uploadPct !== null && uploadPct < 100 ? `Uploading… ${uploadPct}%` : "Processing…"}
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${uploadPct ?? 0}%` }}
            />
          </div>
        </div>
      )}
      {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}

      <p className="text-xs text-zinc-400">
        For a long lecture, recording on your phone and uploading the file here is more reliable — a
        backgrounded or locked device can suspend in-browser recording partway through.
      </p>
    </div>
  );
}
