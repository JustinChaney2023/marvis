import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "./tokenCrypto";

// No TOKEN_ENCRYPTION_KEY set yet — encryption is a no-op, and a legacy
// plaintext value must still round-trip as-is.
delete process.env.TOKEN_ENCRYPTION_KEY;
{
  const plain = "ya29.some-google-access-token";
  assert.equal(encryptSecret(plain), plain, "no key set -> stored as plaintext");
  assert.equal(decryptSecret(plain), plain, "legacy plaintext reads back unchanged");
}

// With a key set, a secret round-trips and is actually encrypted at rest.
process.env.TOKEN_ENCRYPTION_KEY = "test-only-passphrase-not-a-real-secret";
{
  const plain = "1//0g-some-refresh-token";
  const stored = encryptSecret(plain);
  assert.notEqual(stored, plain, "ciphertext must not equal the plaintext");
  assert.ok(stored.startsWith("enc:v1:"), "ciphertext is tagged with the version prefix");
  assert.equal(decryptSecret(stored), plain, "decrypting ciphertext recovers the original plaintext");

  // A value stored before the key existed must still read back once the
  // key is enabled — the whole point of the legacy passthrough.
  assert.equal(decryptSecret(plain), plain, "legacy plaintext still reads correctly once a key is set");

  // Tampering with the ciphertext must be caught (GCM auth tag), not
  // silently decrypt to garbage.
  const tampered = stored.slice(0, -4) + (stored.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  assert.throws(() => decryptSecret(tampered), "a tampered ciphertext must fail to decrypt");
}

// Two encryptions of the same plaintext must differ (random IV per call) —
// a fixed IV would leak whether two stored tokens are identical.
{
  const plain = "same-token-twice";
  assert.notEqual(encryptSecret(plain), encryptSecret(plain));
}

// Ciphertext present but the key has since been removed (e.g. env var
// misconfigured after data was already encrypted) must fail loudly, not
// silently return garbage or the ciphertext itself.
{
  const stored = encryptSecret("some-secret");
  delete process.env.TOKEN_ENCRYPTION_KEY;
  assert.throws(() => decryptSecret(stored), "decrypting without the key must throw, not silently misbehave");
}

console.log("tokenCrypto.test.ts: all checks passed");
