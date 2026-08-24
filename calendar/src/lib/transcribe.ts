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
  | { ok: true; text: string; durationSec: number | null; transcribeMs: number }
  | { ok: false; error: string };

export type ModelListResult = { ok: true; models: string[] } | { ok: false; error: string };

/**
 * Lists the model ids an endpoint actually serves, via the OpenAI-compatible
 * `GET /v1/models` that faster-whisper-server, LocalAI, and OpenAI all
 * implement. Doubles as the connection test: the failure modes are exactly
 * the ones worth telling a self-hoster apart — host unreachable, reached
 * but rejected the key, reached but isn't OpenAI-compatible.
 *
 * Not every server implements it, so a failure here is a hint, never a
 * reason to block saving a config.
 */
export async function listTranscribeModels(config: {
  url: string;
  apiKey?: string | null;
}): Promise<ModelListResult> {
  const base = config.url.replace(/\/+$/, "");
  try {
    await assertNotLinkLocal(config.url);
  } catch {
    return { ok: false, error: "Refusing to contact a link-local address." };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't reach ${base} at all — check the host is up and the address is right (${
        err instanceof Error ? err.message : "network error"
      }).`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: `Reached ${base}, but it rejected the API key (${res.status}). A local whisper server usually needs no key at all.`,
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Reached ${base}, but /models returned ${res.status}.` };
  }

  try {
    const parsed = (await res.json()) as { data?: unknown };
    const models = Array.isArray(parsed.data)
      ? parsed.data
          .map((m) => (m && typeof m === "object" ? (m as { id?: unknown }).id : null))
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (models.length === 0) {
      return {
        ok: false,
        error: `Reached ${base}, but the response wasn't an OpenAI-compatible model list. Enter the model name manually — transcription can still work.`,
      };
    }
    return { ok: true, models: models.sort() };
  } catch {
    return {
      ok: false,
      error: `Reached ${base}, but it didn't return JSON — this may not be an OpenAI-compatible endpoint.`,
    };
  }
}

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
  prompt?: string | null,
): Promise<TranscribeResult> {
  const endpoint = `${config.url.replace(/\/+$/, "")}/audio/transcriptions`;
  const startedAt = Date.now();
  try {
    await assertNotLinkLocal(config.url);

    const absolute = path.join(process.cwd(), "public", "uploads", storedPath);
    const bytes = await readFile(absolute);
    const buildForm = (withPrompt: boolean) => {
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: mimeType }), path.basename(storedPath));
      form.set("model", config.model);
      // Asking for verbose_json gets a duration back for free where the
      // backend supports it; a server that only knows plain json still
      // returns { text }, which the parsing below handles either way.
      form.set("response_format", "verbose_json");
      // "prompt" is the OpenAI-compatible field name; servers map it onto
      // whisper's own initial_prompt argument.
      if (withPrompt && prompt) form.set("prompt", prompt);
      return form;
    };

    const send = (withPrompt: boolean) =>
      fetch(endpoint, {
        method: "POST",
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        body: buildForm(withPrompt),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

    let res = await send(true);
    // The hint is optional by definition, so a server that rejects the
    // field shouldn't cost the user a whole lecture's transcription —
    // drop it and try once more. Only for 4xx: a 5xx or a timeout won't
    // be fixed by sending less, and retrying an hour of audio on those
    // just doubles the wait before the same failure.
    if (!res.ok && prompt && res.status >= 400 && res.status < 500) {
      res = await send(false);
    }

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
      // Times only this call, not summarization — "how fast is your whisper
      // endpoint" is a question about the endpoint, and folding in a
      // separate AI service's latency would answer a different one.
      transcribeMs: Date.now() - startedAt,
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
