// Main-thread side of in-browser live captioning during a recording.
// Runs entirely client-side against a local Whisper model (see
// localWhisperWorker.ts) — never sends audio anywhere. Purely a rough,
// best-effort caption: the real transcript still comes from the
// server-side pipeline (src/lib/transcribe.ts) once the recording is
// uploaded.
"use client";

export type CaptionSegment = { startSec: number; endSec: number; text: string };

const WINDOW_SEC = 8;
const TARGET_SAMPLE_RATE = 16000;

/** Linear-interpolation resample — good enough for rough captions, not archival audio. */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_SAMPLE_RATE) return input;
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Segments whose window overlaps [startSec, endSec] at all — used for the step-out slice. */
export function sliceSegments(
  segments: CaptionSegment[],
  startSec: number,
  endSec: number,
): CaptionSegment[] {
  return segments.filter((s) => s.endSec > startSec && s.startSec < endSec);
}

type Listener = (segment: CaptionSegment) => void;

class LocalWhisper {
  private worker: Worker | null = null;
  private buffer: number[] = [];
  private windowStartSec = 0;
  private samplesPerWindow = WINDOW_SEC * TARGET_SAMPLE_RATE;
  private segments: CaptionSegment[] = [];
  private listeners = new Set<Listener>();
  private status: "loading" | "ready" | "unavailable" = "loading";

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./localWhisperWorker.ts", import.meta.url));
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data as
          | { type: "ready" }
          | { type: "unavailable" }
          | { type: "segment"; startSec: number; endSec: number; text: string };
        if (data.type === "ready") this.status = "ready";
        else if (data.type === "unavailable") this.status = "unavailable";
        else if (data.type === "segment" && data.text.trim()) {
          const segment = { startSec: data.startSec, endSec: data.endSec, text: data.text.trim() };
          this.segments.push(segment);
          this.listeners.forEach((cb) => cb(segment));
        }
      };
    }
    return this.worker;
  }

  getStatus() {
    return this.status;
  }

  onSegment(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getSegments(): CaptionSegment[] {
    return this.segments;
  }

  reset() {
    this.buffer = [];
    this.windowStartSec = 0;
    this.segments = [];
  }

  /** Feed raw PCM captured from the recording's mic stream, at the AudioContext's native sample rate. */
  pushAudio(samples: Float32Array, sampleRate: number) {
    const resampled = resampleTo16k(samples, sampleRate);
    this.buffer.push(...resampled);
    while (this.buffer.length >= this.samplesPerWindow) {
      const chunk = new Float32Array(this.buffer.splice(0, this.samplesPerWindow));
      const startSec = this.windowStartSec;
      const endSec = startSec + WINDOW_SEC;
      this.windowStartSec = endSec;
      this.ensureWorker().postMessage({ type: "transcribe", pcm: chunk, startSec, endSec }, [
        chunk.buffer,
      ]);
    }
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

let instance: LocalWhisper | null = null;

/** One captioner per app session — a fresh recording calls reset(), not a new instance. */
export function getLocalWhisper(): LocalWhisper {
  if (!instance) instance = new LocalWhisper();
  return instance;
}
