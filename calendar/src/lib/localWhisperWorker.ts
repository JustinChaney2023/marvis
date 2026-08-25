// Worker side of local live captioning — keeps whisper inference off the
// main thread so it can't jank the recording UI. Model + WASM runtime
// are fetched from public/models and public/ort (see
// scripts/setup-whisper-assets.mjs); nothing here ever leaves the
// browser. Single-threaded WASM (no SharedArrayBuffer/COOP/COEP) —
// slower, but avoids that whole class of deployment header requirements.
// ponytail: upgrade path is numThreads > 1 once COOP/COEP is wired up.

type TranscribePipeline = (pcm: Float32Array) => Promise<{ text: string }>;

let pipelinePromise: Promise<TranscribePipeline> | null = null;

async function loadPipeline(): Promise<TranscribePipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.localModelPath = "/models/";
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = "/ort/";
    env.backends.onnx.wasm.numThreads = 1;
  }

  const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
    dtype: "q8",
  });
  return async (pcm: Float32Array) => {
    const result = await asr(pcm);
    const first = Array.isArray(result) ? result[0] : result;
    return { text: typeof first?.text === "string" ? first.text : "" };
  };
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data as { type: "transcribe"; pcm: Float32Array; startSec: number; endSec: number };
  if (data.type !== "transcribe") return;

  try {
    if (!pipelinePromise) pipelinePromise = loadPipeline();
    const asr = await pipelinePromise;
    self.postMessage({ type: "ready" });
    const { text } = await asr(data.pcm);
    self.postMessage({ type: "segment", startSec: data.startSec, endSec: data.endSec, text });
  } catch (err) {
    // A model-load failure or a bad window shouldn't kill captioning for
    // the rest of the recording — report once and let later windows retry.
    console.error("localWhisperWorker: transcription failed", err);
    self.postMessage({ type: "unavailable" });
  }
};
