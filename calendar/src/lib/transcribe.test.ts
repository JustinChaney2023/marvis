import assert from "node:assert/strict";
import { formatTimestampedTranscript, parseTimestampedLines } from "./transcribe";

// --- Timestamped transcript formatting ---

// No segments (server returned bare {text}, or genuinely empty audio) —
// caller falls back to the flat transcript rather than an empty string.
assert.equal(formatTimestampedTranscript([]), null);

// A well-formed segment list becomes one "[h:mm:ss] text" line per segment.
assert.equal(
  formatTimestampedTranscript([
    { start: 0, text: "Welcome to the lecture." },
    { start: 65, text: "Today we'll cover chapter four." },
  ]),
  "[0:00] Welcome to the lecture.\n[1:05] Today we'll cover chapter four.",
);

// A hour-plus recording carries the hour component, same as formatDuration
// elsewhere ("1:04:11" style).
assert.equal(
  formatTimestampedTranscript([{ start: 3725, text: "Almost done." }]),
  "[1:02:05] Almost done.",
);

// A malformed segment (missing/garbled fields, from a server that doesn't
// fully implement verbose_json) is skipped rather than crashing or
// emitting a broken line.
assert.equal(
  formatTimestampedTranscript([
    { start: 0, text: "Good segment." },
    { start: "not a number", text: "Bad start." },
    { start: 10, text: "" },
    { start: 20 },
  ] as Parameters<typeof formatTimestampedTranscript>[0]),
  "[0:00] Good segment.",
);

// --- parseTimestampedLines (inverse of formatTimestampedTranscript) ---

// Round-trips through formatTimestampedTranscript, including the
// hour-plus case, for both m:ss and h:mm:ss lines.
assert.deepEqual(
  parseTimestampedLines("[0:00] Welcome to the lecture.\n[1:05] Today we'll cover chapter four."),
  [
    { atSec: 0, text: "Welcome to the lecture." },
    { atSec: 65, text: "Today we'll cover chapter four." },
  ],
);
assert.deepEqual(parseTimestampedLines("[1:02:05] Almost done."), [{ atSec: 3725, text: "Almost done." }]);

// A transcript with no timestamp prefixes at all (a backend that never
// had segments) parses to an empty array — callers use this to detect
// "fall back to the whole transcript" rather than misreading plain text.
assert.deepEqual(parseTimestampedLines("Just a flat transcript with no timestamps."), []);

console.log("transcribe.test.ts: all checks passed");
