import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { _internal, authorizationServerMetadata, isAllowedRedirectUri, mcpAuthChallenge, protectedResourceMetadata } from "./oauth";

// Redirect URIs: https anywhere, http only on loopback, no fragments.
assert.equal(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"), true);
assert.equal(isAllowedRedirectUri("http://localhost:6274/callback"), true);
assert.equal(isAllowedRedirectUri("http://127.0.0.1:33418/cb"), true);
assert.equal(isAllowedRedirectUri("http://example.com/cb"), false);
assert.equal(isAllowedRedirectUri("https://example.com/cb#frag"), false);
assert.equal(isAllowedRedirectUri("javascript:alert(1)"), false);
assert.equal(isAllowedRedirectUri("not a url"), false);

// PKCE S256 matches RFC 7636 appendix B's example.
assert.equal(
  _internal.base64UrlSha256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
  "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
);
assert.equal(_internal.base64UrlSha256("x"), createHash("sha256").update("x").digest("base64url"));

// Discovery documents point at each other consistently.
const origin = "https://season.example";
const pr = protectedResourceMetadata(origin);
assert.equal(pr.resource, "https://season.example/api/mcp");
assert.deepEqual(pr.authorization_servers, [origin]);
const as = authorizationServerMetadata(origin);
assert.equal(as.issuer, origin);
assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
assert.match(mcpAuthChallenge(origin), /resource_metadata="https:\/\/season\.example\/\.well-known\/oauth-protected-resource\/api\/mcp"/);

console.log("oauth.test.ts: all checks passed");
