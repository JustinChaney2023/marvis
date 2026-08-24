import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertNotLinkLocal } from "@/lib/aiClient";

// Same {url, model, apiKey} shape as LocalAiConfig, for the same reason:
// local whisper servers (whisper.cpp server mode, faster-whisper-server,
// LocalAI) and OpenAI's hosted Whisper all implement the identical
// OpenAI-compatible /v1/audio/transcriptions endpoint, so "self-hosted"
// vs "paid API" is a URL swap, not a second code path. apiKey is optional
// because a local server typically has no auth of its own.
export type TranscribeConfig = { url: string; model: string; apiKey?: string | null };

export type TranscribeResult =
  | { ok: true; text: string; durationSec: number | null }
  | { ok: false; error: string };

// An hour of audio through a CPU-only whisper build genuinely takes tens
// of minutes; a 2-minute timeout (the local-AI chat default) would fail
// every real lecture. Generous but still bounded so a wedged endpoint
// doesn't pin a recording in TRANSCRIBING forever.
const TIMEOUT_MS = 30 * 60_000;

/**
 * Sends one audio file to an OpenAI-compatible speech-to-text endpoint.
 *
 * SSRF note: this deliberately allows localhost/LAN targets — a
 * self-hosted whisper server on the same machine or a Tailscale address
 * is the primary intended use, exactly like the local-AI URL. It applies
 * the same (and only the same) restriction aiClient.ts does: the cloud
 * metadata link-local range, which no legitimate whisper server lives on
 * and which would otherwise be a real credential-theft path on any cloud
 * deployment. The stricter public-only rule used for ICS subscriptions
 * would break the feature's main use case and is not applied here.
 */
export async function transcribeAudio(
  storedPath: string,
  mimeType: string,
  config: TranscribeConfig,
): Promise<TranscribeResult> {
  const endpoint = `${config.url.replace(/\/+$/, "")}/audio/transcriptions`;
  try {
    await assertNotLinkLocal(config.url);

    const absolute = path.join(process.cwd(), "public", "uploads", storedPath);
    const bytes = await readFile(absolute);
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: mimeType }), path.basename(storedPath));
    form.set("model", config.model);
    // Asking for verbose_json gets a duration back for free where the
    // backend supports it; a server that only knows plain json still
    // returns { text }, which the parsing below handles either way.
    form.set("response_format", "verbose_json");

    const res = await fetch(endpoint, {
      method: "POST",
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Transcription endpoint at ${config.url} returned ${res.status}: ${body.slice(0, 200) || res.statusText}`,
      };
    }

    const parsed = (await res.json()) as { text?: unknown; duration?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.trim()) {
      return { ok: false, error: "The transcription endpoint returned no text." };
    }
    return {
      ok: true,
      text: parsed.text.trim(),
      durationSec: typeof parsed.duration === "number" ? Math.round(parsed.duration) : null,
    };
  } catch (err) {
    console.error("transcribeAudio failed:", err);
    const message =
      err instanceof Error
        ? `Couldn't reach the transcription endpoint at ${config.url}: ${err.message}`
        : "Transcription request failed.";
    return { ok: false, error: message };
  }
}
