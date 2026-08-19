import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Encrypts Google OAuth access/refresh tokens before they hit the DB.
// dev.db/.env are gitignored, but this app is heading toward self-
// hosting with a public DNS name — a DB backup or file-level leak (a
// misconfigured backup bucket, a copied dev.db) shouldn't hand over live
// Google Calendar credentials in plaintext. AES-256-GCM via node:crypto,
// no new dependency.
//
// TOKEN_ENCRYPTION_KEY is optional: if unset, tokens are stored in
// plaintext exactly as before (so an existing install isn't broken by
// this change) — set it in .env to turn encryption on. A stored
// plaintext token (from before the key existed) still reads correctly
// either way (no ENC_PREFIX means "use as-is"). The access token
// self-heals to encrypted on its next refresh (every ~hour), but the
// refresh token is long-lived and Google doesn't rotate it on refresh —
// it stays plaintext until you disconnect and reconnect Google once
// after setting the key.
const ENC_PREFIX = "enc:v1:";
const KEY_LEN = 32;
const IV_LEN = 12;

function getKey(): Buffer | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) return null;
  // scrypt rather than requiring the env var to already be exactly 32
  // random bytes — any passphrase-shaped string works, same ergonomics
  // as the other secrets in .env.
  return scryptSync(secret, "marvis-token-crypto", KEY_LEN);
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) return plain;

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext, or encryption never enabled
  const key = getKey();
  if (!key) {
    throw new Error(
      "Stored value is encrypted but TOKEN_ENCRYPTION_KEY is unset — cannot decrypt.",
    );
  }

  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LEN);
  const authTag = raw.subarray(IV_LEN, IV_LEN + 16);
  const ciphertext = raw.subarray(IV_LEN + 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
