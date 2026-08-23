import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "marvis_pat_";

/** Raw token shown to the user exactly once; only its hash is ever stored. */
export function generateApiToken(): { raw: string; hash: string } {
  const raw = TOKEN_PREFIX + randomBytes(32).toString("hex");
  return { raw, hash: hashApiToken(raw) };
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
