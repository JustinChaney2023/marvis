import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// "Local" is a slight misnomer now — this same shape also covers hosted
// OpenAI-compatible APIs (MiniMax, etc.) that need a Bearer token, not
// just an unauthenticated local Ollama/LM Studio endpoint. apiKey is
// optional since local endpoints typically have no auth of their own.
export type LocalAiConfig = { url: string; model: string; apiKey?: string | null };

export type AiJsonResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Not every local model reliably honors response_format: json_object, so
// callers also spell out the exact shape in the prompt, and parsing
// tolerates the model wrapping its JSON in prose or a ```json fence.
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in the model's response.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Shared entry point for every "send text, get structured JSON back" AI
 * feature in this app (syllabus import, subtask generation, and anything
 * added later) — one place that knows how to talk to either Claude or a
 * self-hosted OpenAI-compatible endpoint (Settings → AI / local model),
 * instead of each feature reimplementing the same branch.
 */
export async function callAiForJson<T>({
  system,
  userContent,
  schema,
  localAi,
  anthropicApiKey,
  maxTokens = 4000,
  shapeHint,
}: {
  system: string;
  userContent: string;
  schema: z.ZodType<T>;
  localAi: LocalAiConfig | null;
  // Per-account override of ANTHROPIC_API_KEY (Settings → AI), so this
  // works without the server's .env ever having a key at all. Ignored
  // when localAi is set.
  anthropicApiKey?: string | null;
  maxTokens?: number;
  // A one-line plain-English description of the required JSON shape,
  // appended to the prompt for local models — Claude gets exact shape
  // enforcement via output_config.format instead, so this is unused there.
  shapeHint: string;
}): Promise<AiJsonResult<T>> {
  if (localAi) {
    return callLocalAi({ system, userContent, schema, localAi, shapeHint });
  }
  return callClaude({ system, userContent, schema, maxTokens, apiKey: anthropicApiKey ?? null });
}

async function callClaude<T>({
  system,
  userContent,
  schema,
  maxTokens,
  apiKey,
}: {
  system: string;
  userContent: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  apiKey: string | null;
}): Promise<AiJsonResult<T>> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "No Claude API key set — add one in Settings → AI, or set ANTHROPIC_API_KEY in .env.",
    };
  }

  const client = new Anthropic({ apiKey: key });
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(schema) },
    });
    if (!response.parsed_output) {
      return { ok: false, error: "Couldn't parse a response — try again." };
    }
    return { ok: true, data: response.parsed_output };
  } catch (err) {
    console.error("callAiForJson (Claude) failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Request failed." };
  }
}

function isLinkLocalAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 169 && b === 254;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith("fe80:") || lower.includes("::ffff:169.254.");
}

// Settings → AI lets any signed-in user point this app's server at an
// arbitrary "local AI" URL (Ollama/LM Studio on localhost or the LAN is
// the whole point of the feature, so ordinary private addresses are left
// alone). But 169.254.169.254 — the cloud metadata endpoint on AWS/GCP/
// Azure/etc — has no legitimate reason to ever be a local-AI target, and
// hitting it from the server rather than the user's own browser is a
// real SSRF path to instance credentials on any cloud deployment. Checked
// against the resolved address, not the hostname string, so a DNS name
// that merely resolves to a link-local address is caught too.
export async function assertNotLinkLocal(url: string): Promise<void> {
  const hostname = new URL(url).hostname;
  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true })).map((entry) => entry.address);
  if (addresses.some(isLinkLocalAddress)) {
    throw new Error("Refusing to contact a link-local address.");
  }
}

async function callLocalAi<T>({
  system,
  userContent,
  schema,
  localAi,
  shapeHint,
}: {
  system: string;
  userContent: string;
  schema: z.ZodType<T>;
  localAi: LocalAiConfig;
  shapeHint: string;
}): Promise<AiJsonResult<T>> {
  const endpoint = `${localAi.url.replace(/\/+$/, "")}/chat/completions`;
  try {
    await assertNotLinkLocal(localAi.url);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(localAi.apiKey ? { Authorization: `Bearer ${localAi.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: localAi.model,
        messages: [
          {
            role: "system",
            content: `${system} Respond with ONLY a JSON object of the exact shape ${shapeHint} — no prose, no markdown fence, just the JSON object.`,
          },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        stream: false,
      }),
      // Local models on modest hardware can be slow — generous but bounded.
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Local AI at ${localAi.url} returned ${res.status}: ${body.slice(0, 200) || res.statusText}`,
      };
    }

    const responseBody = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = responseBody.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, error: "Local AI returned an empty response." };
    }

    const parsed = schema.safeParse(extractJsonObject(content));
    if (!parsed.success) {
      return { ok: false, error: "Local AI's response didn't match the expected format — try again." };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    console.error("callAiForJson (local AI) failed:", err);
    const message =
      err instanceof Error
        ? `Couldn't reach local AI at ${localAi.url}: ${err.message}`
        : "Local AI request failed.";
    return { ok: false, error: message };
  }
}
