// Client-safe helpers for the recorder UI. Deliberately separate from
// recordings.ts, which imports prisma and so can't be pulled into a
// client bundle — same split as chatActions.ts.

// Preference order for MediaRecorder output. Opus in WebM is the best
// size/quality trade and what Chrome/Firefox produce; Safari supports
// neither and only records MP4. Every entry maps to a MIME type the
// upload route already accepts (see AUDIO_EXTENSIONS in recordings.ts).
export const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/**
 * First supported recording format, or null when the browser supports
 * none of them (rather than silently handing MediaRecorder a type it
 * will reject, or letting it pick an unknown default the upload route
 * would then refuse).
 */
export function pickRecorderMimeType(
  isSupported: (mimeType: string) => boolean,
): string | null {
  return RECORDER_MIME_TYPES.find(isSupported) ?? null;
}

/** Seconds as "9:05" / "1:04:11" — the elapsed-time readout and stored durations. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}
