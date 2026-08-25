import assert from "node:assert/strict";
import {
  audioExtensionFor,
  canRetry,
  chunkTranscript,
  dedupeClarifications,
  dedupeConnections,
  formatCourseContextEntry,
  formatTranscriptionPrompt,
  NOTES_SHAPE_HINT,
  NotesSchema,
  parseQuestions,
  realtimeFactor,
  renderNotes,
  validateConnections,
  type RecordingNotesData,
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
// Boundaries land on whitespace, never mid-word — check against the exact
// whole words in the source text, not just "ends in a lowercase letter"
// (which a truncated word like "ame" would also satisfy).
const SOURCE_WORDS = new Set(["lorem", "ipsum", "dolor", "sit", "amet"]);
assert.ok(
  chunks.every((c) => SOURCE_WORDS.has(c.split(/\s+/).pop() ?? "")),
  "every chunk ends on a complete word from the source text",
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

// --- Course context formatting ---
// No summary yet (still processing, or transcription-only) contributes nothing.
assert.equal(formatCourseContextEntry({ title: "Lecture 1", summary: null }), null);

// Callout blocks (clarifications/connections) are stripped before reuse as
// context for the NEXT recording — otherwise AI-added content compounds
// across a semester instead of staying transcript-derived.
{
  const withCallouts =
    "Core summary of lecture 1.\n\n## Key points\n\n- point one" +
    "\n\n> [!info]- Clarifications\n> **Foo**: bar" +
    "\n\n> [!note]- Connections\n> **Lecture 0**: builds on it";
  const entry = formatCourseContextEntry({ title: "Lecture 1", summary: withCallouts });
  assert.ok(entry);
  assert.ok(!entry.block.includes("Clarifications"), "callout blocks must be stripped from context");
  assert.ok(!entry.block.includes("Connections"), "callout blocks must be stripped from context");
  assert.ok(entry.block.includes("Core summary of lecture 1."));
  assert.ok(entry.block.includes("point one"));
}

// A newline embedded in a title would otherwise break the one-line
// "### <title>" header the model relies on to tell recordings apart.
{
  const entry = formatCourseContextEntry({ title: "Lecture\n1: Intro", summary: "Some notes." });
  assert.ok(entry);
  assert.equal(entry.title, "Lecture 1: Intro");
  assert.equal(entry.block.split("\n")[0], "### Lecture 1: Intro");
}

// Per-recording clipping is bounded, and preserves the header rather than
// flattening it (a joined-then-clipped approach would destroy this).
{
  const long = "word ".repeat(1000); // ~5000 chars, over the 1800 cap
  const entry = formatCourseContextEntry({ title: "Long Lecture", summary: long });
  assert.ok(entry);
  const [header, ...rest] = entry.block.split("\n");
  assert.equal(header, "### Long Lecture");
  assert.ok(rest.join("\n").length <= 1800);
}

// --- connections[].sourceTitle validation ---
const courseTitles = new Set(["Lecture 1", "Lecture 2"]);

assert.deepEqual(
  validateConnections(
    [{ sourceTitle: "Lecture 1", note: "builds on this", external: false }],
    courseTitles,
  ),
  [{ sourceTitle: "Lecture 1", note: "builds on this", external: false }],
  "a connection naming an actual course title is kept",
);

assert.deepEqual(
  validateConnections(
    [{ sourceTitle: "Lecture 9 (never happened)", note: "fabricated", external: false }],
    courseTitles,
  ),
  [],
  "an unattributable connection (no matching title) is dropped",
);

assert.deepEqual(
  validateConnections([{ sourceTitle: null, note: "vague", external: false }], courseTitles),
  [],
  "a non-external connection with no sourceTitle is dropped",
);

assert.deepEqual(
  validateConnections(
    [{ sourceTitle: null, note: "a well-known related concept", external: true }],
    courseTitles,
  ),
  [{ sourceTitle: null, note: "a well-known related concept", external: true }],
  "an external connection needs no sourceTitle",
);

// --- renderNotes() callout rendering ---
const baseNotes: RecordingNotesData = {
  summary: "The core summary.",
  keyPoints: ["First point"],
  clarifications: [],
  connections: [],
  actionItems: [],
};

assert.ok(
  !renderNotes(baseNotes).includes("[!info]"),
  "no Clarifications callout when clarifications is empty",
);
assert.ok(
  !renderNotes(baseNotes).includes("[!note]"),
  "no Connections callout when connections is empty",
);

{
  const withBoth = renderNotes({
    ...baseNotes,
    clarifications: [{ term: "RRTT", explanation: "a made-up acronym" }],
    connections: [{ sourceTitle: "Lecture 1", note: "extends this", external: false }],
  });
  const clarificationsIdx = withBoth.indexOf("[!info]- Clarifications");
  const connectionsIdx = withBoth.indexOf("[!note]- Connections");
  assert.ok(clarificationsIdx > -1 && connectionsIdx > -1, "both callouts render when non-empty");
  assert.ok(clarificationsIdx < connectionsIdx, "Clarifications renders before Connections");
  assert.ok(withBoth.includes("**RRTT**: a made-up acronym"));
  assert.ok(withBoth.includes("**Lecture 1**: extends this"));
}

{
  const external = renderNotes({
    ...baseNotes,
    connections: [{ sourceTitle: null, note: "a related idea", external: true }],
  });
  assert.ok(external.includes("🔭 a related idea"), "external connection gets the 🔭 marker");
  assert.ok(!external.includes("**null**"), "external connection never renders a sourceTitle");
}

// --- Multi-chunk merge: clarification/connection accumulation + dedup ---
// (recordings.ts's summarizeTranscript() combine path, 2-chunk scenario:
// chunk 1 surfaces connection A, chunk 2 surfaces connection B, and the
// combine call repeats A — final result must be [A, B] exactly once each.)
{
  const chunk1: RecordingNotesData["connections"] = [
    { sourceTitle: "Lecture 1", note: "connection A", external: false },
  ];
  const chunk2: RecordingNotesData["connections"] = [
    { sourceTitle: "Lecture 2", note: "connection B", external: false },
  ];
  const combineRepeatsA: RecordingNotesData["connections"] = [
    { sourceTitle: "Lecture 1", note: "connection A, restated", external: false },
  ];
  const merged = dedupeConnections([...chunk1, ...chunk2, ...combineRepeatsA]);
  assert.equal(merged.length, 2, "an earlier chunk's connection survives, and a repeat collapses to one");
  assert.deepEqual(
    merged.map((c) => c.sourceTitle),
    ["Lecture 1", "Lecture 2"],
    "first-seen entry wins for a duplicated sourceTitle, later chunks still contribute new ones",
  );
}

// Two external connections (no sourceTitle to key on) key by note instead.
assert.equal(
  dedupeConnections([
    { sourceTitle: null, note: "same idea", external: true },
    { sourceTitle: null, note: "same idea", external: true },
    { sourceTitle: null, note: "different idea", external: true },
  ]).length,
  2,
  "external connections dedupe by note, not silently collapsed to one",
);

// Clarifications from an earlier chunk survive even when the combine
// call's own output doesn't repeat them (the exact regression Section
// 5.5.1 exists to prevent — the combine pass would otherwise be the only
// source of truth and could silently drop them).
{
  const fromChunks: RecordingNotesData["clarifications"] = [
    { term: "RRTT", explanation: "a made-up acronym" },
  ];
  const fromCombine: RecordingNotesData["clarifications"] = [];
  const merged = dedupeClarifications([...fromChunks, ...fromCombine]);
  assert.deepEqual(merged, fromChunks, "a clarification not repeated by the combine call is not lost");
}

// Same term from two chunks collapses to one entry.
assert.equal(
  dedupeClarifications([
    { term: "RRTT", explanation: "first phrasing" },
    { term: "rrtt", explanation: "second phrasing, different case" },
  ]).length,
  1,
  "clarifications dedupe case-insensitively by term",
);

// --- NotesSchema / shapeHint regression guards ---
// A payload matching the OLD three-field shape must fail validation now
// that clarifications/connections are required — this is exactly the
// regression a stale shapeHint (steering the model toward the old shape)
// would cause.
assert.equal(
  NotesSchema.safeParse({
    summary: "x",
    keyPoints: [],
    actionItems: [],
  }).success,
  false,
  "a payload missing clarifications/connections must fail schema validation",
);
assert.equal(
  NotesSchema.safeParse({
    summary: "x",
    keyPoints: [],
    clarifications: [],
    connections: [],
    actionItems: [],
  }).success,
  true,
  "the full five-field shape validates",
);

for (const field of ["summary", "keyPoints", "clarifications", "connections", "actionItems"]) {
  assert.ok(NOTES_SHAPE_HINT.includes(`"${field}"`), `shapeHint must mention "${field}"`);
}

// --- parseQuestions ---
assert.deepEqual(parseQuestions(null), []);
assert.deepEqual(parseQuestions("not json"), []);
assert.deepEqual(parseQuestions(JSON.stringify({ not: "an array" })), []);
assert.deepEqual(
  parseQuestions(JSON.stringify([{ atSec: 42, text: "what was that acronym?", answer: null }])),
  [{ atSec: 42, text: "what was that acronym?", answer: null }],
);
assert.deepEqual(
  parseQuestions(JSON.stringify([{ atSec: 42, text: "answered already", answer: "It means X." }])),
  [{ atSec: 42, text: "answered already", answer: "It means X." }],
);
// Malformed entries (missing fields, wrong types) are dropped rather than crashing.
assert.deepEqual(
  parseQuestions(JSON.stringify([{ atSec: "not a number", text: "bad" }, { text: "no atSec" }, null])),
  [],
);
// postHoc questions (asked from the review screen, not during capture)
// keep the flag; old rows with no postHoc field at all must not gain one.
assert.deepEqual(
  parseQuestions(JSON.stringify([{ atSec: 2760, text: "asked later", answer: "An answer.", postHoc: true }])),
  [{ atSec: 2760, text: "asked later", answer: "An answer.", postHoc: true }],
);
assert.deepEqual(
  parseQuestions(JSON.stringify([{ atSec: 42, text: "old row", answer: null }]))[0],
  { atSec: 42, text: "old row", answer: null },
);

console.log("recordings.test.ts: all checks passed");
