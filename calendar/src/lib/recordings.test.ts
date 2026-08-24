import assert from "node:assert/strict";
import {
  audioExtensionFor,
  canRetry,
  chunkTranscript,
  formatTranscriptionPrompt,
  realtimeFactor,
} from "./recordings";

// --- MIME matching ---
assert.equal(audioExtensionFor("audio/webm"), "webm");
// The case this exists for: browser MediaRecorder always emits a codecs
// parameter, so an exact-match lookup would reject every in-app recording.
assert.equal(audioExtensionFor("audio/webm;codecs=opus"), "webm");
assert.equal(audioExtensionFor("audio/ogg; codecs=opus"), "ogg");
assert.equal(audioExtensionFor("AUDIO/MPEG"), "mp3");
assert.equal(audioExtensionFor("audio/x-m4a"), "m4a");
assert.equal(audioExtensionFor("video/mp4"), null);
assert.equal(audioExtensionFor(""), null);

// --- Transcript chunking ---
// A typical lecture fits one pass — the common case must not chunk.
const lecture = "word ".repeat(9_000); // ~45k chars
assert.equal(chunkTranscript(lecture).length, 1);

// Something genuinely long chunks instead of being truncated, and every
// character survives: dropping the back half of a recording is the exact
// failure this is here to prevent.
const long = "lorem ipsum dolor sit amet ".repeat(8_000); // ~216k chars
const chunks = chunkTranscript(long);
assert.ok(chunks.length > 1, "a multi-hour transcript should chunk");
const rejoined = chunks.join(" ").replace(/\s+/g, " ").trim();
assert.equal(rejoined, long.replace(/\s+/g, " ").trim(), "chunking must not lose content");
assert.ok(
  chunks.every((c) => !c.startsWith(" ") && !c.endsWith(" ")),
  "chunks are trimmed",
);
// Boundaries land on whitespace, never mid-word.
assert.ok(
  chunks.every((c) => !/\S$/.test(c) || c.endsWith("amet") || c.endsWith("ipsum") || /[a-z]$/.test(c)),
  "chunk boundaries fall on a word edge",
);

// --- Retry eligibility ---
const now = new Date("2026-08-24T12:00:00Z");
const justNow = new Date(now.getTime() - 30_000);
const ageAgo = new Date(now.getTime() - 30 * 60_000);

assert.equal(canRetry("FAILED", justNow, now), true, "a failed run is always retryable");
assert.equal(canRetry("UPLOADED", justNow, now), true, "one that never started is retryable");
assert.equal(canRetry("DONE", ageAgo, now), false, "a finished recording is never reprocessed");
assert.equal(
  canRetry("TRANSCRIBING", justNow, now),
  false,
  "a run that's actually in flight isn't double-started",
);
assert.equal(
  canRetry("TRANSCRIBING", ageAgo, now),
  true,
  "a run stranded by a server restart becomes retryable",
);
assert.equal(canRetry("SUMMARIZING", ageAgo, now), true);


// --- Measured throughput ---
// Nothing measurable yet -> no number at all, rather than a fabricated one.
assert.equal(realtimeFactor([]), null);
assert.equal(realtimeFactor([{ durationSec: null, transcribeMs: 5_000 }]), null);
assert.equal(realtimeFactor([{ durationSec: 600, transcribeMs: null }]), null);

// 600s of audio in 60s of wall clock = 10x realtime.
assert.equal(realtimeFactor([{ durationSec: 600, transcribeMs: 60_000 }]), 10);

// Summed, not averaged per-recording: a 50-minute lecture must outweigh a
// 1-minute memo instead of counting equally.
const mixed = realtimeFactor([
  { durationSec: 3_000, transcribeMs: 300_000 }, // 10x, the long one
  { durationSec: 60, transcribeMs: 30_000 }, // 2x, a short outlier
]);
assert.ok(mixed !== null && mixed > 9 && mixed < 10, `long recording dominates, got ${mixed}`);

// --- Transcription context prompt ---
// A recording attached to nothing has no context to offer, and an empty
// hint must be absent rather than an empty string the server would send.
assert.equal(formatTranscriptionPrompt({}), null);
assert.equal(formatTranscriptionPrompt({ projectName: "  ", eventNotes: "" }), null);

const full = formatTranscriptionPrompt({
  projectName: "Organic Chemistry II",
  instructor: "Dr. Aoife Nwachukwu",
  books: ["Clayden, Organic Chemistry", "Vollhardt & Schore"],
  eventTitle: "Lecture 12",
  eventNotes: "Pericyclic reactions and the Diels-Alder mechanism",
});
assert.ok(full !== null);
// The whole point: the proper nouns whisper mangles are all present.
for (const term of ["Organic Chemistry II", "Aoife Nwachukwu", "Diels-Alder", "Clayden"]) {
  assert.ok(full.includes(term), `prompt should carry "${term}", got: ${full}`);
}
// Prose, not a keyword dump — it's decoded as if it were prior speech.
assert.ok(full.startsWith("This is a recording from Organic Chemistry II, taught by Dr. Aoife Nwachukwu."));

// Prose fields are excluded by the caller, but a caller that passes only
// a course still gets a usable hint rather than a malformed one.
assert.equal(
  formatTranscriptionPrompt({ projectName: "Linear Algebra" }),
  "This is a recording from Linear Algebra.",
);
assert.equal(formatTranscriptionPrompt({ instructor: "Dr. Vance" }), "The speaker is Dr. Vance.");

// An event with no project still contributes the most recording-specific
// vocabulary there is — that day's topic.
const eventOnly = formatTranscriptionPrompt({ eventTitle: "Standup", eventNotes: "Kafka migration" });
assert.equal(eventOnly, "Topic: Standup — Kafka migration.");

// Budget: a runaway notes field must not blow past the prompt limit, and
// what survives must still be intact words rather than a severed token.
const huge = formatTranscriptionPrompt({
  projectName: "Seminar",
  eventNotes: "alpha bravo ".repeat(500),
});
assert.ok(huge !== null && huge.length <= 700, `prompt must stay under budget, got ${huge?.length}`);
assert.ok(!/\balph$|\bbrav$/.test(huge), "must not truncate mid-word");

// A long book list is capped rather than crowding out everything else.
const manyBooks = formatTranscriptionPrompt({
  projectName: "History",
  books: ["One", "Two", "Three", "Four", "Five"],
});
assert.ok(manyBooks !== null && !manyBooks.includes("Four"), "book list is capped");

// Newlines from a LIST-type ProjectField must not survive into the hint.
const multiline = formatTranscriptionPrompt({ eventNotes: "line one\nline two" });
assert.equal(multiline, "Topic: line one line two.");

console.log("recordings.test.ts: all checks passed");
