import assert from "node:assert/strict";
import { formatDuration, pickRecorderMimeType, RECORDER_MIME_TYPES } from "./recordingFormat";

// --- MIME preference ---
// Chrome/Firefox: Opus-in-WebM wins because it's first and supported.
assert.equal(pickRecorderMimeType(() => true), "audio/webm;codecs=opus");

// Safari supports neither WebM variant — it must still find audio/mp4
// rather than falling back to null and refusing to record.
const safari = (t: string) => t.startsWith("audio/mp4");
assert.equal(pickRecorderMimeType(safari), "audio/mp4");

// Preference order is honored, not just "any supported one".
const noOpusParam = (t: string) => t === "audio/webm" || t === "audio/mp4";
assert.equal(pickRecorderMimeType(noOpusParam), "audio/webm");

// No supported type -> null, so the UI can say so instead of handing
// MediaRecorder something it rejects.
assert.equal(pickRecorderMimeType(() => false), null);

// Every candidate must be a type the upload route actually accepts —
// a format we can record but not store would fail only after a full
// lecture had been captured.
for (const type of RECORDER_MIME_TYPES) {
  const base = type.split(";")[0];
  assert.ok(
    ["audio/webm", "audio/mp4", "audio/ogg"].includes(base),
    `${type} must map to an accepted audio base type`,
  );
}

// --- Duration formatting ---
assert.equal(formatDuration(0), "0:00");
assert.equal(formatDuration(5), "0:05");
assert.equal(formatDuration(65), "1:05");
assert.equal(formatDuration(600), "10:00");
// Past an hour, minutes pad to two digits so the colons stay aligned.
assert.equal(formatDuration(3600), "1:00:00");
assert.equal(formatDuration(3851), "1:04:11");
// A 50-minute lecture, the case this whole feature exists for.
assert.equal(formatDuration(3000), "50:00");
// Fractional seconds from a timer tick shouldn't render "0:5.5".
assert.equal(formatDuration(5.9), "0:05");
assert.equal(formatDuration(-3), "0:00");

console.log("recordingFormat.test.ts: all checks passed");
