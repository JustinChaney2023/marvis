import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolveUploadPath } from "@/lib/uploads";

const execFileAsync = promisify(execFile);

// Checked once per server process — ffmpeg isn't going to appear or vanish
// mid-run, and probing it on every recording would cost a process spawn
// for no reason. Also flipped to false permanently the first time a run
// fails on a missing filter (see the catch below) — that's a build too
// old for this filter chain, not a transient error, and retrying it once
// per recording forever would just burn minutes on every future upload.
let ffmpegAvailable: boolean | null = null;

async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable === null) {
    ffmpegAvailable = await execFileAsync("ffmpeg", ["-version"]).then(
      () => true,
      () => false,
    );
  }
  return ffmpegAvailable;
}

// An hour of audio through ffmpeg's CPU filters is seconds, not minutes —
// generous headroom for a slow self-hosted box without risking a wedged
// ffmpeg process pinning a recording indefinitely.
const CLEAN_TIMEOUT_MS = 5 * 60_000;

// execFile's default maxBuffer (1MB) is stdout+stderr combined, and
// ffmpeg's per-frame progress stats on stderr can blow past that on a
// long lecture, killing an otherwise-successful encode. -nostats/
// -hide_banner/-loglevel error cut stderr to just real errors, and this
// is extra headroom on top of that.
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type CleanedAudio = { storedPath: string; cleanup: () => Promise<void> };

/**
 * Denoises and loudness-normalizes audio before it reaches the transcriber
 * — a lecture recorded on a phone across a room is exactly what Whisper
 * struggles with (quiet, hissy, uneven volume), and this is the cheapest
 * lever that doesn't involve swapping models. Also resamples to the 16kHz
 * mono Whisper consumes internally anyway.
 *
 * Output is FLAC, not WAV: 16kHz mono PCM runs ~1.9MB/min uncompressed, so
 * an hour-plus lecture in WAV would be *larger* than the compressed
 * webm/mp3 source it came from — the opposite of the point, and
 * transcribeAudio buffers the whole file into memory before it uploads.
 * FLAC is lossless (no accuracy cost) and every OpenAI-compatible whisper
 * server accepts it.
 *
 * Returns null (never throws) when ffmpeg isn't installed or the run
 * fails — self-hosters already accept "optional binary, degrade if
 * absent" for the whisper endpoint itself, and failing a whole recording
 * over an optional cleanup step would be worse than skipping it.
 * processRecording falls back to the original audio either way.
 */
export async function cleanAudioForTranscription(
  userId: string,
  sourceStoredPath: string,
): Promise<CleanedAudio | null> {
  if (!(await hasFfmpeg())) return null;

  const source = resolveUploadPath(sourceStoredPath);
  if (!source) return null;

  // Written under the same per-user upload directory (already created at
  // upload time) rather than the OS temp dir, so it passes through the
  // same resolveUploadPath ownership/traversal boundary transcribeAudio
  // already trusts — no second path-safety model to maintain. The uuid
  // keeps concurrent recordings for the same user from ever colliding.
  const storedPath = `${userId}/.clean-${randomUUID()}.flac`;
  const output = resolveUploadPath(storedPath);
  if (!output) return null;
  const cleanup = () => unlink(output).catch(() => {});

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-nostats", "-hide_banner", "-loglevel", "error",
        "-i", source,
        // highpass: cuts room rumble/HVAC below speech range.
        // afftdn: FFT noise reduction against a steady noise floor (fans,
        // hiss) — nf is the assumed noise floor in dB, not a hard gate.
        // loudnorm: normalizes to a consistent speech loudness so a
        // lecturer who wanders from the mic doesn't fall below whatever
        // the decoder's silence threshold is. Single-pass dynamic mode
        // can't clip — TP=-1.5 true-peak-limits it regardless of input.
        // ponytail: nf=-35 is a conservative guess, never A/B'd against a
        // real lecture (this machine has no ffmpeg to test with) — raise
        // toward -25 (afftdn's default is -50, valid range -80..-20) if
        // background hiss is still surviving into transcripts.
        //
        // Deliberately no silenceremove: trimming dead air would shift
        // every timestamp after the cut, and the whole transcript
        // downstream is timestamped ("[h:mm:ss] text" segments, see
        // formatTimestampedTranscript in transcribe.ts) — the step-out
        // catch-up note and answerQuestions' ±90s window both key off
        // those times matching when things were actually said. Silence
        // trimming would desync both.
        "-af", "highpass=f=80,afftdn=nf=-35,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ar", "16000",
        "-ac", "1",
        output,
      ],
      { timeout: CLEAN_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
    );
    return { storedPath, cleanup };
  } catch (err) {
    // An unrecognized filter means this ffmpeg build is too old for the
    // chain above — that's permanent, not a one-off failure, so stop
    // trying for the rest of this process's lifetime rather than paying
    // a doomed ffmpeg spawn on every future recording.
    const message = err instanceof Error ? err.message : String(err);
    if (/no such filter|unknown filter/i.test(message)) ffmpegAvailable = false;

    console.error("cleanAudioForTranscription failed, using original audio:", err);
    await cleanup();
    return null;
  }
}
