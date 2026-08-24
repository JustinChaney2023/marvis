import { assertNotLinkLocal } from "@/lib/aiClient";

export type ConvertResult = { ok: true; text: string } | { ok: false; error: string };

// A big scanned PDF on a busy box is slow, but this is a user waiting on an
// upload, not a background lecture transcription — minutes, not half an hour.
const TIMEOUT_MS = 2 * 60_000;

/**
 * Converts one document to Markdown via the markitdown service.
 *
 * SSRF note: same policy as the transcription endpoint, and for the same
 * reason — a self-hosted converter on localhost or a Tailscale address is
 * the intended deployment, so only the cloud-metadata link-local range is
 * refused. The stricter public-only rule used for ICS subscriptions would
 * break the feature outright.
 */
export async function convertToMarkdown(
  bytes: Buffer,
  filename: string,
  mimeType: string,
  url: string,
): Promise<ConvertResult> {
  const base = url.replace(/\/+$/, "");
  try {
    await assertNotLinkLocal(url);
  } catch {
    return { ok: false, error: "Refusing to contact a link-local address." };
  }

  let res: Response;
  try {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
    res = await fetch(`${base}/convert`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't reach the document converter at ${base} — check the service is running and the address is right (${
        err instanceof Error ? err.message : "network error"
      }).`,
    };
  }

  if (!res.ok) {
    // The service puts the actual reason ("no text found", "unsupported")
    // in FastAPI's `detail`, which is far more useful than the status code.
    const detail = await res
      .json()
      .then((b: { detail?: unknown }) => (typeof b.detail === "string" ? b.detail : null))
      .catch(() => null);
    return { ok: false, error: detail ?? `The document converter returned ${res.status}.` };
  }

  try {
    const parsed = (await res.json()) as { markdown?: unknown };
    if (typeof parsed.markdown !== "string" || !parsed.markdown.trim()) {
      return { ok: false, error: "The document converter returned no text." };
    }
    return { ok: true, text: parsed.markdown };
  } catch {
    return {
      ok: false,
      error: `Reached ${base}, but it didn't return JSON — is that the markitdown service?`,
    };
  }
}

/** Connection test for Settings. Hits /health so it needs no sample file. */
export async function testMarkitdownEndpoint(url: string): Promise<ConvertResult> {
  const base = url.replace(/\/+$/, "");
  try {
    await assertNotLinkLocal(url);
  } catch {
    return { ok: false, error: "Refusing to contact a link-local address." };
  }
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `Reached ${base}, but /health returned ${res.status}.` };
    return { ok: true, text: "Connected." };
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't reach ${base} (${err instanceof Error ? err.message : "network error"}).`,
    };
  }
}
