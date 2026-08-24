import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RecordingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callAiForJson } from "@/lib/aiClient";
import { transcribeAudio } from "@/lib/transcribe";
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

const NotesSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  actionItems: z.array(z.object({ title: z.string(), dueDate: z.string().nullable() })),
});

export type RecordingActionItem = { title: string; dueDate: string | null };

const NOTES_SYSTEM =
  "You turn a raw transcript of a recording into notes someone will actually reread later. " +
  "First work out what kind of recording it is, then write the notes that kind deserves: " +
  "for a lecture or talk, capture the concepts, definitions, examples, and anything flagged as exam-relevant — not who said what; " +
  "for a meeting or conversation, capture decisions, who owns what, open questions, and follow-ups. " +
  "Write `summary` as markdown a human reads top to bottom (use headings and bullets where they help). " +
  "`keyPoints` is a handful of one-line takeaways. " +
  "`actionItems` is only genuine things someone must DO afterwards — a lecture often has few or none, so return an empty array rather than inventing busywork. " +
  "Set an actionItem's dueDate to YYYY-MM-DD only when the transcript actually states a date; otherwise null. " +
  "Transcripts are machine-generated and contain misheard words — infer the intended meaning where obvious, and don't quote garbled text as if it were exact.";

/** Renders the AI's structured result into the markdown that becomes Recording.summary. */
function renderNotes(data: z.infer<typeof NotesSchema>): string {
  const points = data.keyPoints.filter((p) => p.trim());
  if (points.length === 0) return data.summary.trim();
  return `${data.summary.trim()}\n\n## Key points\n\n${points.map((p) => `- ${p}`).join("\n")}`;
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
): Promise<SummarizeResult> {
  const shapeHint =
    '{"summary": string, "keyPoints": [string, ...], "actionItems": [{"title": string, "dueDate": string|null}, ...]}';
  const call = (system: string, userContent: string) =>
    callAiForJson({
      system,
      userContent,
      schema: NotesSchema,
      localAi,
      anthropicApiKey,
      maxTokens: 4000,
      shapeHint,
    });

  const chunks = chunkTranscript(transcript);
  if (chunks.length === 1) {
    const result = await call(NOTES_SYSTEM, chunks[0]);
    if (!result.ok) return result;
    return { ok: true, summary: renderNotes(result.data), actionItems: result.data.actionItems };
  }

  const partials: string[] = [];
  const actionItems: RecordingActionItem[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const result = await call(
      `${NOTES_SYSTEM} This is part ${i + 1} of ${chunks.length} of one long recording — cover only this part; another pass will combine them.`,
      chunk,
    );
    if (!result.ok) return result;
    partials.push(renderNotes(result.data));
    actionItems.push(...result.data.actionItems);
  }

  const combined = await call(
    `${NOTES_SYSTEM} You are given the section notes from one long recording, in order. Merge them into a single coherent set of notes — deduplicate, keep the through-line, don't just concatenate.`,
    partials.join("\n\n---\n\n"),
  );
  if (!combined.ok) return combined;
  // Keep every section's action items: the merge pass is asked for prose
  // quality, and quietly dropping a to-do because the combiner didn't
  // repeat it is the exact failure this whole feature exists to avoid.
  const merged = [...actionItems, ...combined.data.actionItems];
  const seen = new Set<string>();
  const deduped = merged.filter((item) => {
    const key = item.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: true, summary: renderNotes(combined.data), actionItems: deduped };
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

    await prisma.recording.update({
      where: { id: recordingId },
      data: { status: "TRANSCRIBING", errorMessage: null },
    });
    const transcribed = await transcribeAudio(recording.audioPath, recording.mimeType, transcribeConfig);
    if (!transcribed.ok) {
      await fail(recordingId, transcribed.error);
      return;
    }

    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        transcript: transcribed.text,
        durationSec: transcribed.durationSec,
        transcribeMs: transcribed.transcribeMs,
        status: "SUMMARIZING",
      },
    });

    const { localAi, anthropicApiKey } = aiConfigFromSettings(settings);
    const notes = await summarizeTranscript(transcribed.text, localAi, anthropicApiKey);
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
  await unlink(path.join(process.cwd(), "public", "uploads", recording.audioPath)).catch(() => {});
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
