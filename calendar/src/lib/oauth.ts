import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateApiToken } from "@/lib/apiTokens";

/**
 * Minimal OAuth 2.1 authorization server for the MCP endpoint, per the MCP
 * authorization spec: protected-resource + authorization-server metadata,
 * dynamic client registration, authorization code + PKCE (S256), public
 * clients only. The issued access token is a regular PersonalAccessToken,
 * so everything downstream (requireApiUser, Settings → revoke) just works.
 */

const CODE_TTL_MS = 5 * 60_000;

/** Public origin of this app — APP_URL when set (behind a proxy), else the request's own. */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  return host ? `${proto ?? url.protocol.replace(":", "")}://${host}` : url.origin;
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "Season",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["season"],
  };
}

/** The WWW-Authenticate header an unauthenticated MCP request gets back. */
export function mcpAuthChallenge(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

// Redirect URIs must be https, or http on a loopback host (native/CLI
// clients listening locally). Anything else could leak codes in transit.
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  return false;
}

export type RegistrationResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: string; description: string };

export async function registerClient(input: unknown): Promise<RegistrationResult> {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (redirectUris.length === 0 || redirectUris.length > 10) {
    return { ok: false, error: "invalid_redirect_uri", description: "Provide 1–10 redirect_uris." };
  }
  const bad = redirectUris.find((u) => !isAllowedRedirectUri(u));
  if (bad) {
    return { ok: false, error: "invalid_redirect_uri", description: `Redirect URI not allowed: ${bad}` };
  }
  const name = (typeof body.client_name === "string" && body.client_name.trim().slice(0, 80)) || "MCP client";
  const clientId = `season_client_${randomBytes(16).toString("hex")}`;
  await prisma.oAuthClient.create({
    data: { clientId, name, redirectUris: JSON.stringify(redirectUris) },
  });
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
};

export type ValidatedAuthorize =
  | { ok: true; request: AuthorizeRequest; clientName: string }
  // Errors that must NOT redirect (unknown client / redirect URI — the
  // spec forbids bouncing to an unverified URI).
  | { ok: false; fatal: true; message: string }
  // Errors reported back to the (verified) redirect URI.
  | { ok: false; fatal: false; redirectTo: string };

export async function validateAuthorizeParams(params: Record<string, string | undefined>): Promise<ValidatedAuthorize> {
  const clientId = params.client_id ?? "";
  const redirectUri = params.redirect_uri ?? "";
  const client = clientId ? await prisma.oAuthClient.findUnique({ where: { clientId } }) : null;
  if (!client) return { ok: false, fatal: true, message: "Unknown application." };
  const registered: string[] = JSON.parse(client.redirectUris);
  if (!registered.includes(redirectUri)) {
    return { ok: false, fatal: true, message: "That redirect address isn't registered for this application." };
  }
  const state = params.state ?? null;
  const fail = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return { ok: false as const, fatal: false as const, redirectTo: url.toString() };
  };
  if (params.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  return {
    ok: true,
    clientName: client.name,
    request: { clientId, redirectUri, state, codeChallenge: params.code_challenge },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Issues a one-time code and returns the URL to send the browser back to. */
export async function approveAuthorization(userId: string, req: AuthorizeRequest): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  // Opportunistic sweep of abandoned codes (approved but never exchanged).
  await prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: sha256(code),
      clientId: req.clientId,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  const url = new URL(req.redirectUri);
  url.searchParams.set("code", code);
  if (req.state) url.searchParams.set("state", req.state);
  return url.toString();
}

export function denialRedirect(req: AuthorizeRequest): string {
  const url = new URL(req.redirectUri);
  url.searchParams.set("error", "access_denied");
  if (req.state) url.searchParams.set("state", req.state);
  return url.toString();
}

export type TokenResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; description: string };

export async function exchangeCode(params: URLSearchParams): Promise<TokenResult> {
  const fail = (error: string, description: string, status = 400): TokenResult => ({ ok: false, status, error, description });
  if (params.get("grant_type") !== "authorization_code") {
    return fail("unsupported_grant_type", "Only authorization_code is supported.");
  }
  const code = params.get("code") ?? "";
  const verifier = params.get("code_verifier") ?? "";
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!code || !verifier) return fail("invalid_request", "code and code_verifier are required.");

  // Single use: delete first, then validate what was deleted — a replayed
  // code finds nothing, even if two requests race.
  const row = await prisma.oAuthAuthorizationCode
    .delete({ where: { codeHash: sha256(code) }, include: { client: true } })
    .catch(() => null);
  if (!row) return fail("invalid_grant", "Unknown or already-used code.");
  if (row.expiresAt < new Date()) return fail("invalid_grant", "Code expired.");
  if (clientId && clientId !== row.clientId) return fail("invalid_grant", "Code was issued to a different client.");
  if (redirectUri && redirectUri !== row.redirectUri) return fail("invalid_grant", "redirect_uri mismatch.");
  if (base64UrlSha256(verifier) !== row.codeChallenge) return fail("invalid_grant", "PKCE verification failed.");

  const { raw, hash } = generateApiToken();
  await prisma.personalAccessToken.create({
    data: { userId: row.userId, name: `${row.client.name} (connected app)`, tokenHash: hash },
  });
  return { ok: true, body: { access_token: raw, token_type: "Bearer", scope: "season" } };
}

// Exposed for tests.
export const _internal = { base64UrlSha256 };
