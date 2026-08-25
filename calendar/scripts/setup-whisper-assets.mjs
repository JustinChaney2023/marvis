// Populates public/ort and public/models with the binaries the
// in-browser local-whisper captioning feature needs at runtime
// (src/lib/localWhisperWorker.ts). Run once per machine: `npm run
// setup:whisper`. Not wired to postinstall — that would make every
// `npm install` silently do a multi-megabyte network fetch and break
// offline/CI installs that never touch this feature.
import { mkdir, readdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "..", "public");

async function copyOrtWasm() {
  const src = path.join(root, "..", "node_modules", "onnxruntime-web", "dist");
  const dest = path.join(publicDir, "ort");
  await mkdir(dest, { recursive: true });
  const files = (await readdir(src)).filter((f) => f.endsWith(".wasm") || f.endsWith(".mjs"));
  for (const file of files) {
    await copyFile(path.join(src, file), path.join(dest, file));
  }
  console.log(`Copied ${files.length} onnxruntime-web asset(s) to public/ort/`);
}

const MODEL_REPO = "onnx-community/whisper-tiny.en";
// Exact filenames on the onnx-community/whisper-tiny.en repo (verified
// via the HF models API) — transformers.js's dtype "q8" maps to the
// "_quantized" suffix, not "_q8".
const MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];

async function fetchModel() {
  const dest = path.join(publicDir, "models", MODEL_REPO);
  await mkdir(path.join(dest, "onnx"), { recursive: true });
  for (const file of MODEL_FILES) {
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/main/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(path.join(dest, file), bytes);
    console.log(`Fetched ${file} (${(bytes.length / 1024).toFixed(0)}KB)`);
  }
}

await copyOrtWasm();
await fetchModel();
console.log("Local-whisper assets ready.");
