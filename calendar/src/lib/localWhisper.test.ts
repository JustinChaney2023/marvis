import assert from "node:assert/strict";
import { resampleTo16k, sliceSegments } from "./localWhisper";

// --- resampleTo16k ---
// Same rate: passthrough, no copy needed.
{
  const input = new Float32Array([0.1, 0.2, 0.3]);
  assert.equal(resampleTo16k(input, 16000), input);
}

// Downsampling from a common device rate (48kHz) shrinks the buffer by
// the expected ratio and preserves the first/last samples.
{
  const input = new Float32Array(48000).fill(0);
  input[0] = 1;
  input.fill(1, 47900); // trailing run, not a single sample, so it survives interpolation
  const out = resampleTo16k(input, 48000);
  assert.equal(out.length, 16000);
  assert.equal(out[0], 1);
  assert.ok(Math.abs(out[out.length - 1] - 1) < 0.01);
}

// --- sliceSegments ---
const segments = [
  { startSec: 0, endSec: 8, text: "a" },
  { startSec: 8, endSec: 16, text: "b" },
  { startSec: 16, endSec: 24, text: "c" },
];

// A step-out window strictly inside one segment still includes it —
// partial overlap is enough, since captions are already coarse 8s windows.
assert.deepEqual(sliceSegments(segments, 10, 14).map((s) => s.text), ["b"]);

// A window spanning a segment boundary includes both overlapping segments.
assert.deepEqual(sliceSegments(segments, 6, 18).map((s) => s.text), ["a", "b", "c"]);

// A window touching only the boundary (no real overlap) excludes the adjacent segment.
assert.deepEqual(sliceSegments(segments, 8, 16).map((s) => s.text), ["b"]);

// Nothing overlaps -> empty, not an error.
assert.deepEqual(sliceSegments(segments, 100, 110), []);

console.log("localWhisper.test.ts: all checks passed");
