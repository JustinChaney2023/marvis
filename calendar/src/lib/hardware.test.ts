import assert from "node:assert/strict";
import { isOwnAddress, pickModelId, recommendWhisperModel } from "./hardware";

// --- Endpoint locality ---
// The case this exists for: whisper on a desktop, app on a laptop, linked
// over Tailscale. Scanning the laptop would describe the wrong machine.
const laptop = ["192.168.1.50", "100.64.0.2", "127.0.0.1"];
assert.equal(isOwnAddress(["100.64.0.9"], laptop), false, "another Tailscale host is not us");
assert.equal(isOwnAddress(["100.64.0.2"], laptop), true, "our own Tailscale address is us");
assert.equal(isOwnAddress(["127.0.0.1"], []), true, "loopback is us even with no interfaces listed");
assert.equal(isOwnAddress(["::1"], []), true);
assert.equal(isOwnAddress(["::ffff:192.168.1.50"], laptop), true, "IPv4-mapped IPv6 still matches");
assert.equal(isOwnAddress(["8.8.8.8"], laptop), false);

// --- Model id matching ---
// Servers name the same model differently, so a recommended *size* has to
// resolve against whatever ids the endpoint actually reported.
const served = ["Systran/faster-whisper-small", "Systran/faster-whisper-large-v3"];
assert.equal(pickModelId(["large-v3", "medium"], served), "Systran/faster-whisper-large-v3");
// First preference absent -> fall through to one that is served.
assert.equal(pickModelId(["distil-large-v3", "small"], served), "Systran/faster-whisper-small");
// Nothing matched (or nothing discovered) -> the bare size, still editable.
assert.equal(pickModelId(["base", "tiny"], served), "base");
assert.equal(pickModelId(["large-v3"], []), "large-v3");

// --- Recommendation tiers ---
const gpu = (vramMb: number) => ({ gpuName: "NVIDIA RTX", vramMb, cpuCores: 8, ramGb: 32 });
assert.equal(recommendWhisperModel(gpu(12_288)).preferences[0], "large-v3");
assert.equal(recommendWhisperModel(gpu(8_192)).preferences[0], "distil-large-v3");
assert.equal(recommendWhisperModel(gpu(4_096)).preferences[0], "small");

// No GPU: a capable CPU still manages small, a weak one shouldn't be told to try.
assert.equal(
  recommendWhisperModel({ gpuName: null, vramMb: null, cpuCores: 16, ramGb: 32 }).preferences[0],
  "small",
);
assert.equal(
  recommendWhisperModel({ gpuName: null, vramMb: null, cpuCores: 4, ramGb: 8 }).preferences[0],
  "base",
);
// A GPU present but with unreadable VRAM must not be treated as high-end.
assert.equal(
  recommendWhisperModel({ gpuName: "NVIDIA RTX", vramMb: null, cpuCores: 4, ramGb: 8 })
    .preferences[0],
  "base",
);

// Every recommendation explains itself — the suggestion is never applied
// automatically, so the reasoning is the point.
for (const scan of [gpu(12_288), gpu(4_096), { gpuName: null, vramMb: null, cpuCores: 2, ramGb: 4 }]) {
  assert.ok(recommendWhisperModel(scan).reason.length > 20, "reason is a real explanation");
}

console.log("hardware.test.ts: all checks passed");
