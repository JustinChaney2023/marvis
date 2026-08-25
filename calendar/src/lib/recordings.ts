import { unlink } from "node:fs/promises";
import path from "node:path";
import { resolveUploadPath } from "@/lib/uploads";
import { z } from "zod";
import type { RecordingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callAiForJson } from "@/lib/aiClient";
import { transcribeAudio, parseTimestampedLines } from "@/lib/transcribe";
import { cleanAudioForTranscription } from "@/lib/audioClean";
import { aiConfigFromSettings, getAppSettings, transcribeConfigFromSettings } from "@/lib/settings";

// Browser MediaRecorder emits "audio/webm;codecs=opus" — the codecs
// parameter is part of a normal MIME type, so an exact-match lookup
// (like the attachments route's) rejects every browser recording. Match
// on the base type only.
const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

/** File extension for an audio MIME type, ignoring any ";codecs=..." parameters. Null = not an accepted audio type. */
export function audioExtensionFor(mimeType: string): string | null {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return AUDIO_EXTENSIONS[base] ?? null;
}

// A 50-minute lecture transcribes to roughly 45k characters, which fits
// one pass comfortably for Claude and for any local model with a 32k
// context. Only genuinely long recordings (multi-hour) chunk, so the
// common case stays a single call and nothing is ever silently dropped.
const MAX_SINGLE_PASS_CHARS = 60_000;
const CHUNK_CHARS = 50_000;

/** Splits on whitespace near each boundary so a chunk never ends mid-word. */
export function chunkTranscript(text: string, chunkChars = CHUNK_CHARS): string[] {
  if (text.length <= MAX_SINGLE_PASS_CHARS) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > chunkChars) {
    const window = rest.slice(0, chunkChars);
    const breakAt = window.lastIndexOf("\n") > 0 ? window.lastIndexOf("\n") : window.lastIndexOf(" ");
    const cut = breakAt > chunkChars / 2 ? breakAt : chunkChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks;
}

// ponytail: fire-and-forget processing with no job queue — a server
// restart mid-run strands a row in TRANSCRIBING/SUMMARIZING. Rather than
// adding a worker for a single-user self-hosted app, such a row is
// treated as retryable once it's been untouched this long. Swap in a real
// queue if this ever runs multi-instance.
const STUCK_AFTER_MS = 10 * 60_000;

/** Whether a recording can be (re)processed — FAILED, never-started, or stranded by a restart. */
export function canRetry(status: RecordingStatus, updatedAt: Date, now: Date): boolean {
  if (status === "DONE") return false;
  if (status === "FAILED" || status === "UPLOADED") return true;
  return now.getTime() - updatedAt.getTime() > STUCK_AFTER_MS;
}

// Enough samples to smooth out one anomalous run, few enough that a
// recent endpoint/model change shows up quickly.
const THROUGHPUT_SAMPLES = 5;

/**
 * How many seconds of audio the configured endpoint transcribes per second
 * of wall clock, from the user's own recent recordings. Summed rather than
 * averaged per-recording so a 50-minute lecture counts for more than a
 * 2-minute voice memo. Null when nothing measurable has run yet — a
 * fabricated number here would be worse than an empty space, and a server
 * that doesn't report duration never yields one.
 */
export function realtimeFactor(
  samples: { durationSec: number | null; transcribeMs: number | null }[],
): number | null {
  const usable = samples
    .filter((s) => s.durationSec && s.transcribeMs && s.transcribeMs > 0)
    .slice(0, THROUGHPUT_SAMPLES);
  if (usable.length === 0) return null;
  const audioSec = usable.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  const wallSec = usable.reduce((sum, s) => sum + (s.transcribeMs ?? 0), 0) / 1000;
  if (wallSec <= 0) return null;
  return audioSec / wallSec;
}

// --- Transcription context prompting ---
//
// Whisper accepts an initial prompt that biases decoding toward the
// supplied vocabulary — the cheapest possible domain adaptation, and one
// no generic whisper install can do, because it needs this app's own
// syllabus data. It's bounded by half the 448-token decoder window
// (~224 tokens), and implementations disagree about which end they cut
// when you exceed that. Rather than bet on it, everything below keeps
// the prompt under budget so the server never has to truncate at all.
// ~3.5 chars/token is deliberately pessimistic: names and book titles
// tokenize worse than plain prose.
const PROMPT_MAX_CHARS = 700;
const NOTES_MAX_CHARS = 300;
const MAX_BOOKS = 3;

/** ProjectField keys that carry actual spoken vocabulary. */
const INSTRUCTOR_KEY = "instructorName";
const BOOK_KEYS = ["requiredBooks", "optionalBooks"];
// Nothing writes this yet — ProjectFields render read-only today, so an
// editable override ships with the recorder UI pass. Reading it now
// costs one lookup and means that pass is a UI change only.
const EXTRA_VOCAB_KEY = "transcriptionVocabulary";
// Deliberately absent: gradingPolicy, gradingScale, officeHours*,
// instructorEmail, meetingLocation. Those are prose or trivia, not
// words anyone says aloud — feeding them in would spend the budget
// biasing the decoder toward vocabulary that never occurs in the audio.

export type PromptSource = {
  projectName?: string | null;
  instructor?: string | null;
  books?: string[];
  extraVocabulary?: string | null;
  eventTitle?: string | null;
  eventNotes?: string | null;
};

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  const flat = collapse(text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

/**
 * Builds the natural-language hint sent to the transcriber. Prose, not a
 * comma-separated keyword dump: the prompt is decoded as if it were
 * preceding speech, so text shaped like real sentences biases better
 * than a bare term list. Returns null when there's nothing worth saying.
 */
export function formatTranscriptionPrompt(src: PromptSource): string | null {
  const sentences: string[] = [];
  const course = src.projectName?.trim();
  const instructor = src.instructor?.trim();

  if (course && instructor) sentences.push(`This is a recording from ${course}, taught by ${instructor}.`);
  else if (course) sentences.push(`This is a recording from ${course}.`);
  else if (instructor) sentences.push(`The speaker is ${instructor}.`);

  const topic = [src.eventTitle?.trim(), src.eventNotes ? clip(src.eventNotes, NOTES_MAX_CHARS) : ""]
    .filter(Boolean)
    .join(" — ");
  if (topic) sentences.push(`Topic: ${collapse(topic)}.`);

  const extra = src.extraVocabulary ? collapse(src.extraVocabulary) : "";
  if (extra) sentences.push(`Terms that may come up: ${extra}.`);

  const books = (src.books ?? []).map(collapse).filter(Boolean).slice(0, MAX_BOOKS);
  if (books.length > 0) sentences.push(`References: ${books.join("; ")}.`);

  if (sentences.length === 0) return null;
  const prompt = sentences.join(" ");
  return prompt.length <= PROMPT_MAX_CHARS ? prompt : clip(prompt, PROMPT_MAX_CHARS);
}

/** Splits a LIST-type ProjectField (newline-separated) into entries. */
const splitList = (value: string | null) =>
  (value ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

/** Gathers a recording's course/lecture context into a transcriber hint. */
export async function buildTranscriptionPrompt(recording: {
  projectId: string | null;
  eventId: string | null;
}): Promise<string | null> {
  const [project, event] = await Promise.all([
    recording.projectId
      ? prisma.project.findUnique({
          where: { id: recording.projectId },
          select: { name: true, fields: { select: { key: true, value: true } } },
        })
      : null,
    recording.eventId
      ? prisma.event.findUnique({ where: { id: recording.eventId }, select: { title: true, notes: true } })
      : null,
  ]);

  const fieldValue = (key: string) => project?.fields.find((f) => f.key === key)?.value ?? null;
  return formatTranscriptionPrompt({
    projectName: project?.name,
    instructor: fieldValue(INSTRUCTOR_KEY),
    books: BOOK_KEYS.flatMap((k) => splitList(fieldValue(k))),
    extraVocabulary: fieldValue(EXTRA_VOCAB_KEY),
    eventTitle: event?.title,
    eventNotes: event?.notes,
  });
}

const COURSE_CONTEXT_RECORDINGS = 3;
const COURSE_CONTEXT_CHARS_PER_RECORDING = 1800;

export type CourseContext = { text: string; titles: Set<string> };

/**
 * Formats one prior recording as a course-context block: strips its own
 * AI-added callout blocks (so a later recording's context is never built
 * out of an earlier one's clarifications/connections — no compounding —
 * or its callout markup syntax), clips the remaining transcript-derived
 * core, and collapses the title to a single line so the "### <title>"
 * header can never break across lines. Returns null when the recording
 * has nothing usable to contribute (empty summary).
 */
export function formatCourseContextEntry(
  recording: { title: string; summary: string | null },
): { title: string; block: string } | null {
  if (!recording.summary) return null;
  // Everything before the first callout block is the transcript-derived
  // core (summary + key points) — see renderNotes()'s fixed section
  // order below, which makes this split point deterministic.
  const core = recording.summary.split("\n\n> [!")[0];
  const clipped = clip(core, COURSE_CONTEXT_CHARS_PER_RECORDING);
  if (!clipped) return null;
  const title = collapse(recording.title);
  return { title, block: `### ${title}\n${clipped}` };
}

/**
 * Gathers prior notes from the same course so the model writing this
 * recording's notes can genuinely connect ideas across lectures, not just
 * within one.
 */
export async function buildCourseContext(
  projectId: string | null,
  excludeRecordingId: string,
): Promise<CourseContext | null> {
  if (!projectId) return null;

  const prior = await prisma.recording.findMany({
    where: { projectId, status: "DONE", id: { not: excludeRecordingId } },
    orderBy: { createdAt: "desc" },
    take: COURSE_CONTEXT_RECORDINGS,
    select: { title: true, summary: true },
  });

  const blocks: string[] = [];
  const titles = new Set<string>();
  for (const recording of prior) {
    const entry = formatCourseContextEntry(recording);
    if (!entry) continue;
    titles.add(entry.title);
    blocks.push(entry.block);
  }

  if (blocks.length === 0) return null;
  return { text: blocks.join("\n\n"), titles };
}

export const NotesSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  clarifications: z.array(z.object({
    term: z.string(),
    explanation: z.string(),
  })),
  connections: z.array(z.object({
    // Must exactly match one of the titles given in the course context
    // (buildCourseContext) — null only for external:true, where by
    // definition there is no prior recording to name.
    sourceTitle: z.string().nullable(),
    note: z.string(),
    // Optional aside beyond the course; never a fabricated citation.
    external: z.boolean().default(false),
  })),
  actionItems: z.array(z.object({ title: z.string(), dueDate: z.string().nullable() })),
});

export type RecordingActionItem = { title: string; dueDate: string | null };

const NOTES_SYSTEM =
  "You turn a raw transcript of a recording into notes someone will actually reread later. " +
  "First work out what kind of recording it is, then write the notes that kind deserves: " +
  "for a lecture or talk, capture the concepts, definitions, examples, and anything flagged as exam-relevant — not who said what — " +
  "plus any course logistics announced (grading breakdown, exam format and dates, textbook requirements, submission and AI policies): students reread notes to find exactly these; " +
  "for a meeting or conversation, capture decisions, who owns what, open questions, and follow-ups. " +
  "Write `summary` as markdown a human reads top to bottom (use headings and bullets where they help). " +
  "`keyPoints` is a handful of one-line takeaways. " +
  "`actionItems` is only genuine things someone must DO afterwards — return an empty array rather than inventing busywork, " +
  "but an announcement that requires action (download a required textbook, prepare a posted problem for a named class day, buy materials, register for something) is a genuine action item even in a lecture. " +
  "Set an actionItem's dueDate to YYYY-MM-DD only when the transcript itself speaks the date (\"February 5th\", \"the 12th\"). " +
  "A relative reference (\"this Wednesday\", \"next class\") or a recurring cadence (\"every Wednesday\", \"weekly\") gets dueDate null — put the cadence in the title instead (e.g. \"Prepare weekly discussion problem (Wednesdays)\"). " +
  "Transcripts are machine-generated and contain misheard words — infer the intended meaning where obvious, and don't quote garbled text as if it were exact. " +
  "Additionally: " +
  "`clarifications`: for any jargon, acronym, or term the transcript uses without defining, add a plain-language explanation. Only include terms that actually appear in the transcript — never introduce a term the transcript didn't use. Empty array if nothing needs clarifying. " +
  "`connections`: you may be given notes from earlier recordings in the same course, below. For each genuine conceptual link between this lecture and one of those, add an entry naming what specifically connects them — never a vague \"this relates to earlier material.\" If no course context is given, or nothing genuinely connects, return an empty array. Do not fabricate a connection to sound thorough. " +
  "Optionally, and only if a connection to something outside the provided course context is obvious and directly relevant (a well-known related concept, not a specific citation), you may add one such entry with `external: true`. This is secondary to the within-course connections above and should be rare.";

export const NOTES_SHAPE_HINT =
  '{"summary": string, "keyPoints": [string, ...], ' +
  '"clarifications": [{"term": string, "explanation": string}, ...], ' +
  '"connections": [{"sourceTitle": string|null, "note": string, "external": boolean}, ...], ' +
  '"actionItems": [{"title": string, "dueDate": string|null}, ...]}';

/**
 * Drops a `connections` entry that claims a prior recording no longer /
 * never present in the course context handed to this call — an
 * unattributable connection is worse than none, since nobody (human now,
 * Phase 2's Obsidian link later) can verify or navigate to it.
 */
export type RecordingConnection = z.infer<typeof NotesSchema>["connections"][number];
export type RecordingClarification = z.infer<typeof NotesSchema>["clarifications"][number];

const STEP_OUT_SCHEMA = z.object({ summary: z.string() });
const STEP_OUT_SHAPE_HINT = '{"summary": string}';
const STEP_OUT_SYSTEM =
  "You are given a rough, machine-generated caption of a few minutes someone stepped away from a recording. " +
  "Write a short (1-3 sentence) catch-up note answering 'what did I miss?' The captions come from a small local " +
  "speech model and are less accurate than a real transcript — infer intended meaning where obvious, and don't " +
  "quote garbled fragments as if exact. If the text is too sparse or garbled to say anything useful, say so plainly.";

export type StepOutSummaryResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * The step-out button's on-the-spot summary: rough local-whisper captions
 * for the window someone was away, not the real per-recording transcript
 * (that's summarizeTranscript, above). Deliberately not persisted to the
 * Recording row — this is a disposable "what did I miss" note, not part
 * of the permanent record.
 */
export async function summarizeStepOut(
  roughCaption: string,
  localAi: Parameters<typeof callAiForJson>[0]["localAi"],
  anthropicApiKey: string | null,
): Promise<StepOutSummaryResult> {
  if (roughCaption.trim().length < 10) {
    return { ok: false, error: "Not enough was captured to summarize." };
  }
  const result = await callAiForJson({
    system: STEP_OUT_SYSTEM,
    userContent: roughCaption,
    schema: STEP_OUT_SCHEMA,
    localAi,
    anthropicApiKey,
    maxTokens: 300,
    shapeHint: STEP_OUT_SHAPE_HINT,
  });
  if (!result.ok) return result;
  return { ok: true, summary: result.data.summary };
}

export function validateConnections(
  connections: RecordingConnection[],
  courseTitles: ReadonlySet<string>,
): RecordingConnection[] {
  return connections.filter((c) => {
    if (c.external) return true;
    return c.sourceTitle !== null && courseTitles.has(c.sourceTitle);
  });
}

export type RecordingNotesData = z.infer<typeof NotesSchema>;

/** Deduplicates by normalized `term`, same pattern as the existing `actionItems` dedup below. */
export function dedupeClarifications(items: RecordingClarification[]): RecordingClarification[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    const key = c.term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deduplicates by `sourceTitle` (or, for `external` entries with no `sourceTitle`, by `note`). */
export function dedupeConnections(items: RecordingConnection[]): RecordingConnection[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    const key = c.external
      ? `external:${c.note.trim().toLowerCase()}`
      : `source:${(c.sourceTitle ?? "").trim().toLowerCase()}`;
    if (key === "external:" || key === "source:" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Renders the AI's structured result into the markdown that becomes Recording.summary. */
export function renderNotes(data: RecordingNotesData): string {
  const parts = [data.summary.trim()];

  const points = data.keyPoints.filter((p) => p.trim());
  if (points.length > 0) {
    parts.push(`## Key points\n\n${points.map((p) => `- ${p}`).join("\n")}`);
  }

  const clarifications = data.clarifications.filter((c) => c.term.trim() && c.explanation.trim());
  if (clarifications.length > 0) {
    const body = clarifications.map((c) => `> **${c.term}**: ${c.explanation}`).join("\n> \n");
    parts.push(`> [!info]- Clarifications\n${body}`);
  }

  const connections = data.connections.filter((c) => c.note.trim());
  if (connections.length > 0) {
    const body = connections
      .map((c) => (c.external ? `> 🔭 ${c.note}` : `> **${c.sourceTitle}**: ${c.note}`))
      .join("\n> \n");
    parts.push(`> [!note]- Connections\n${body}`);
  }

  return parts.join("\n\n");
}

type SummarizeResult =
  | { ok: true; summary: string; actionItems: RecordingActionItem[] }
  | { ok: false; error: string };

/**
 * Transcript -> readable notes + reviewable action items, via the same
 * callAiForJson path (Claude or a local model) every other AI feature
 * here uses. Long transcripts are summarized in chunks and then combined
 * rather than truncated, so the back half of a lecture never silently
 * disappears.
 */
export async function summarizeTranscript(
  transcript: string,
  localAi: Parameters<typeof callAiForJson>[0]["localAi"],
  anthropicApiKey: string | null,
  glossary?: string | null,
  courseContext?: CourseContext | null,
): Promise<SummarizeResult> {
  // Second use of the same context the transcriber got: whisper biases
  // toward these terms but still fumbles some, so the model that writes
  // the notes gets told what the right spellings are. It corrects only
  // what it writes — Recording.transcript stays the verbatim machine
  // output, because a record you've silently rewritten is no longer
  // evidence of what the transcriber actually heard.
  let system = glossary
    ? `${NOTES_SYSTEM} Context for this recording: ${glossary} Names, titles and terms from that context are the correct spellings — when the transcript garbles one, use the correct form in your notes.`
    : NOTES_SYSTEM;
  // Same placement as the glossary above: background for interpreting the
  // transcript, never blended into the transcript text itself (which is
  // always the user content, below).
  if (courseContext) {
    system += ` Prior recordings in this course, for context only: ${courseContext.text}`;
  }
  const courseTitles = courseContext?.titles ?? new Set<string>();
  const call = (system: string, userContent: string) =>
    callAiForJson({
      system,
      userContent,
      schema: NotesSchema,
      localAi,
      anthropicApiKey,
      maxTokens: 4000,
      shapeHint: NOTES_SHAPE_HINT,
    });

  const chunks = chunkTranscript(transcript);
  if (chunks.length === 1) {
    const result = await call(system, chunks[0]);
    if (!result.ok) return result;
    const connections = validateConnections(result.data.connections, courseTitles);
    return {
      ok: true,
      summary: renderNotes({ ...result.data, connections }),
      actionItems: result.data.actionItems,
    };
  }

  const partials: string[] = [];
  const actionItems: RecordingActionItem[] = [];
  const clarifications: z.infer<typeof NotesSchema>["clarifications"] = [];
  const connections: z.infer<typeof NotesSchema>["connections"] = [];
  for (const [i, chunk] of chunks.entries()) {
    const result = await call(
      `${system} This is part ${i + 1} of ${chunks.length} of one long recording — cover only this part; another pass will combine them.`,
      chunk,
    );
    if (!result.ok) return result;
    const validConnections = validateConnections(result.data.connections, courseTitles);
    // Partials feed the combine call's input as prose to merge — only the
    // transcript-derived summary/key points belong there. Clarifications/
    // connections are accumulated separately (below) and rendered exactly
    // once, on the final merged result; rendering them into a partial too
    // would let the combine pass re-absorb them into its own summary
    // prose, duplicating content and leaking callout markup into it.
    partials.push(renderNotes({ ...result.data, clarifications: [], connections: [] }));
    actionItems.push(...result.data.actionItems);
    clarifications.push(...result.data.clarifications);
    connections.push(...validConnections);
  }

  const combined = await call(
    `${system} You are given the section notes from one long recording, in order. Merge them into a single coherent set of notes — deduplicate, keep the through-line, don't just concatenate.`,
    partials.join("\n\n---\n\n"),
  );
  if (!combined.ok) return combined;
  const combinedConnections = validateConnections(combined.data.connections, courseTitles);

  // Keep every section's action items/clarifications/connections: the
  // merge pass is asked for prose quality, and quietly dropping one
  // because the combiner didn't repeat it is the exact failure this
  // whole feature exists to avoid.
  const mergedActionItems = [...actionItems, ...combined.data.actionItems];
  const seenActionItems = new Set<string>();
  const dedupedActionItems = mergedActionItems.filter((item) => {
    const key = item.title.trim().toLowerCase();
    if (!key || seenActionItems.has(key)) return false;
    seenActionItems.add(key);
    return true;
  });

  const dedupedClarifications = dedupeClarifications([...clarifications, ...combined.data.clarifications]);
  const dedupedConnections = dedupeConnections([...connections, ...combinedConnections]);

  return {
    ok: true,
    summary: renderNotes({
      summary: combined.data.summary,
      keyPoints: combined.data.keyPoints,
      clarifications: dedupedClarifications,
      connections: dedupedConnections,
      actionItems: dedupedActionItems,
    }),
    actionItems: dedupedActionItems,
  };
}

async function fail(recordingId: string, errorMessage: string): Promise<void> {
  await prisma.recording.update({
    where: { id: recordingId },
    data: { status: "FAILED", errorMessage },
  });
}

/**
 * The whole pipeline for one recording: transcribe, then summarize,
 * updating status as it goes so a polling client can show progress.
 * Deliberately never throws — every failure lands as FAILED plus a
 * message the user can act on. Called fire-and-forget (see
 * startProcessing) because transcribing an hour of audio far outlives
 * any HTTP request.
 */
export async function processRecording(recordingId: string): Promise<void> {
  try {
    const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
    if (!recording) return;

    const settings = await getAppSettings(recording.userId);
    const transcribeConfig = transcribeConfigFromSettings(settings);
    if (!transcribeConfig) {
      await fail(
        recordingId,
        "No transcription endpoint configured — set one in Settings → AI (a local whisper server, or a hosted OpenAI-compatible one).",
      );
      return;
    }

    // A retry after a summarization-only failure already paid for
    // transcription (transcript is non-null but status is FAILED) — skip
    // straight to SUMMARIZING rather than re-running an hour of whisper
    // time for a step that already succeeded.
    const alreadyTranscribed = !!recording.transcript;

    // Atomically claim this row before doing any real work. Without this,
    // two overlapping calls for the same recording — a double-click retry,
    // the same retry fired from two tabs — would both pass canRetry's
    // pre-check and race to completion: duplicate AI spend, and whichever
    // write lands second silently clobbers the other's result. A single
    // conditional UPDATE is atomic even though this pre-check and
    // canRetry() aren't otherwise synchronized with each other.
    const claimed = await prisma.recording.updateMany({
      where: {
        id: recordingId,
        OR: [
          { status: "UPLOADED" },
          { status: "FAILED" },
          {
            status: { in: ["TRANSCRIBING", "SUMMARIZING"] },
            updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) },
          },
        ],
      },
      data: { status: alreadyTranscribed ? "SUMMARIZING" : "TRANSCRIBING", errorMessage: null },
    });
    if (claimed.count === 0) return;

    // Gathered once, used twice: as whisper's decoding hint, then as the
    // glossary the notes are written against — needed either way, even
    // when transcription itself is skipped below.
    const contextPrompt = await buildTranscriptionPrompt(recording);

    let transcript = recording.transcript;
    if (!transcript) {
      // Best-effort denoise/normalize pass — see cleanAudioForTranscription
      // for why a failure here just falls back to the original file rather
      // than failing the recording.
      const cleaned = await cleanAudioForTranscription(recording.userId, recording.audioPath);
      let transcribed: Awaited<ReturnType<typeof transcribeAudio>>;
      try {
        transcribed = await transcribeAudio(
          cleaned?.storedPath ?? recording.audioPath,
          cleaned ? "audio/flac" : recording.mimeType,
          transcribeConfig,
          contextPrompt,
        );
      } finally {
        // In a finally, not inline after the call — transcribeAudio
        // doesn't throw today, but the ~100MB+ temp file this leaves
        // behind on a future throw has no other sweeper, so this cleanup
        // can't be allowed to depend on that staying true.
        if (cleaned) await cleaned.cleanup();
      }
      if (!transcribed.ok) {
        await fail(recordingId, transcribed.error);
        return;
      }

      transcript = transcribed.text;
      await prisma.recording.update({
        where: { id: recordingId },
        data: {
          transcript: transcribed.text,
          durationSec: transcribed.durationSec,
          transcribeMs: transcribed.transcribeMs,
          status: "SUMMARIZING",
        },
      });
    }

    const { localAi, anthropicApiKey } = aiConfigFromSettings(settings);

    // Answered right away, before summarization — the transcript needed
    // for this is already saved above, so a later summarize failure
    // (handled below) doesn't strand these unanswered. Skipped entirely
    // once every asked question already has an answer, so a summarize
    // retry doesn't redo this AI call for nothing.
    const askedQuestions = parseQuestions(recording.questions);
    if (askedQuestions.some((q) => q.answer === null)) {
      const answered = await answerQuestions(askedQuestions, transcript, localAi, anthropicApiKey);
      await prisma.recording.update({
        where: { id: recordingId },
        data: { questions: JSON.stringify(answered) },
      });
    }

    const courseContext = await buildCourseContext(recording.projectId, recording.id);
    const notes = await summarizeTranscript(
      transcript,
      localAi,
      anthropicApiKey,
      contextPrompt,
      courseContext,
    );
    if (!notes.ok) {
      // The transcript is already saved above — a summarization failure
      // leaves the expensive half of the work intact and retryable.
      await fail(recordingId, notes.error);
      return;
    }

    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        summary: notes.summary,
        actionItems: JSON.stringify(notes.actionItems),
        status: "DONE",
        errorMessage: null,
      },
    });
  } catch (err) {
    console.error("processRecording failed:", err);
    await fail(recordingId, err instanceof Error ? err.message : "Processing failed.").catch(() => {});
  }
}

/** Kicks off processing without blocking the caller's response. */
export function startProcessing(recordingId: string): void {
  void processRecording(recordingId).catch((err) => console.error("startProcessing:", err));
}

export function parseActionItems(raw: string | null): RecordingActionItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is RecordingActionItem => !!i && typeof i.title === "string",
    );
  } catch {
    return [];
  }
}

/**
 * A question about a recording — either typed in live during capture
 * (RecordingCapture.tsx; atSec is elapsed recording time, answered from a
 * window around that moment) or asked afterward from the review screen
 * once the recording is DONE (RecordingsList.tsx; postHoc: true, answered
 * from the full transcript since there's no "moment it was asked" to
 * window around — atSec is just the recording's duration, for sorting).
 */
export type RecordingQuestion = { atSec: number; text: string; answer: string | null; postHoc?: boolean };

export function parseQuestions(raw: string | null): RecordingQuestion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (q): q is RecordingQuestion =>
          !!q &&
          typeof q.atSec === "number" &&
          typeof q.text === "string" &&
          (q.answer === null || typeof q.answer === "string"),
      )
      .map((q) => (q.postHoc === true ? { ...q, postHoc: true } : q));
  } catch {
    return [];
  }
}

const QUESTION_CONTEXT_WINDOW_SEC = 90;
const QuestionAnswerSchema = z.object({ answer: z.string() });
const QUESTION_ANSWER_SHAPE_HINT = '{"answer": string}';
const QUESTION_ANSWER_SYSTEM =
  "You answer a question about a recording, using only the transcript excerpt given as context — never anything " +
  "outside it. If the excerpt doesn't actually address the question, say plainly that it wasn't discussed rather " +
  "than guessing.";

/** Shared AI call behind both answerQuestions (windowed, live) and answerPostHocQuestion (full transcript, after the fact). */
async function answerFromContext(
  questionText: string,
  context: string,
  localAi: Parameters<typeof callAiForJson>[0]["localAi"],
  anthropicApiKey: string | null,
): Promise<string> {
  if (!context.trim()) return "Nothing was said near that point in the recording.";
  const result = await callAiForJson({
    system: QUESTION_ANSWER_SYSTEM,
    userContent: `Question: ${questionText}\n\nTranscript excerpt:\n${context}`,
    schema: QuestionAnswerSchema,
    localAi,
    anthropicApiKey,
    maxTokens: 300,
    shapeHint: QUESTION_ANSWER_SHAPE_HINT,
  });
  return result.ok ? result.data.answer : `Couldn't answer: ${result.error}`;
}

/**
 * Fills in the `answer` for any question that doesn't have one yet, using
 * the portion of the transcript spoken near when it was asked (±90s) —
 * not the whole transcript, so the answer reflects what was actually
 * being discussed at that moment rather than the recording as a whole.
 * Falls back to the full transcript only when the transcript has no
 * per-line timestamps at all (a backend that doesn't return segments).
 */
export async function answerQuestions(
  questions: RecordingQuestion[],
  transcript: string,
  localAi: Parameters<typeof callAiForJson>[0]["localAi"],
  anthropicApiKey: string | null,
): Promise<RecordingQuestion[]> {
  const timestampedLines = parseTimestampedLines(transcript);
  const answered: RecordingQuestion[] = [];
  for (const q of questions) {
    if (q.answer !== null) {
      answered.push(q);
      continue;
    }
    const context =
      timestampedLines.length > 0
        ? timestampedLines
            .filter((l) => Math.abs(l.atSec - q.atSec) <= QUESTION_CONTEXT_WINDOW_SEC)
            .map((l) => l.text)
            .join(" ")
        : transcript;
    answered.push({ ...q, answer: await answerFromContext(q.text, context, localAi, anthropicApiKey) });
  }
  return answered;
}

/**
 * Answers a question asked from the review screen after a recording is
 * already DONE (RecordingsList.tsx) — not tied to a moment during
 * capture, so it gets the whole transcript as context rather than
 * answerQuestions' ±90s window.
 */
export async function answerPostHocQuestion(
  questionText: string,
  transcript: string,
  localAi: Parameters<typeof callAiForJson>[0]["localAi"],
  anthropicApiKey: string | null,
): Promise<string> {
  return answerFromContext(questionText, transcript, localAi, anthropicApiKey);
}

// --- Shared data layer: both the server actions and /api/v1 call these,
// so ownership rules live in exactly one place. ---

export async function listRecordings(
  userId: string,
  filter: { eventId?: string | null; projectId?: string | null } = {},
) {
  return prisma.recording.findMany({
    where: {
      userId,
      ...(filter.eventId ? { eventId: filter.eventId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Measured endpoint throughput from this user's recent completed recordings, or null if nothing measurable has run. */
export async function getRealtimeFactor(userId: string): Promise<number | null> {
  const samples = await prisma.recording.findMany({
    where: { userId, status: "DONE", durationSec: { not: null }, transcribeMs: { not: null } },
    orderBy: { createdAt: "desc" },
    take: THROUGHPUT_SAMPLES,
    select: { durationSec: true, transcribeMs: true },
  });
  return realtimeFactor(samples);
}

export async function getRecording(userId: string, id: string) {
  return prisma.recording.findFirst({ where: { id, userId } });
}

export async function createRecording(
  userId: string,
  input: {
    title: string;
    audioPath: string;
    mimeType: string;
    sizeBytes: number;
    eventId?: string | null;
    projectId?: string | null;
    // Timestamped questions asked during capture (RecordingCapture.tsx) —
    // answers are filled in by processRecording once the transcript exists.
    questions?: { atSec: number; text: string }[];
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Same guard as addTaskAttachmentAction: the upload route always hands
  // back "<uploaderId>/<uuid>.<ext>", so anything else means a caller
  // went around it to claim another user's file or traverse out of
  // public/uploads entirely.
  if (!input.audioPath.startsWith(`${userId}/`) || input.audioPath.includes("..")) {
    return { ok: false, error: "Invalid audio path." };
  }
  if (!audioExtensionFor(input.mimeType)) {
    return { ok: false, error: "Unsupported audio type." };
  }

  const [event, project] = await Promise.all([
    input.eventId ? prisma.event.findFirst({ where: { id: input.eventId, userId }, select: { id: true } }) : null,
    input.projectId ? prisma.project.findFirst({ where: { id: input.projectId, userId }, select: { id: true } }) : null,
  ]);

  const recording = await prisma.recording.create({
    data: {
      userId,
      title: input.title.trim() || "Untitled recording",
      audioPath: input.audioPath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      // Unverified ids are dropped rather than erroring, matching how
      // taskFieldsFromFormData treats a foreign project/assignee id.
      eventId: event?.id ?? null,
      projectId: project?.id ?? null,
      questions:
        input.questions && input.questions.length > 0
          ? JSON.stringify(input.questions.map((q) => ({ atSec: q.atSec, text: q.text, answer: null })))
          : null,
    },
  });
  startProcessing(recording.id);
  return { ok: true, id: recording.id };
}

export async function deleteRecording(userId: string, id: string): Promise<boolean> {
  const recording = await getRecording(userId, id);
  if (!recording) return false;
  await prisma.recording.delete({ where: { id } });
  // Best-effort, same as deleteTaskAttachmentAction: a missing file
  // shouldn't block removing the row the user asked to delete.
  const absolute = resolveUploadPath(recording.audioPath);
  if (absolute) await unlink(absolute).catch(() => {});
  return true;
}

export async function retryRecording(
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const recording = await getRecording(userId, id);
  if (!recording) return { ok: false, error: "Not found." };
  if (!canRetry(recording.status, recording.updatedAt, new Date())) {
    return { ok: false, error: "That recording is already done or still processing." };
  }
  startProcessing(recording.id);
  return { ok: true };
}
