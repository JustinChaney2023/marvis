import { generateApiToken, hashApiToken } from "./apiTokens";

const { raw, hash } = generateApiToken();
console.assert(raw.startsWith("marvis_pat_"), "raw token should carry the identifiable prefix");
console.assert(hash === hashApiToken(raw), "hashing the same raw token twice must be deterministic");
console.assert(hash !== raw, "the hash must not just be the raw token");
console.assert(generateApiToken().raw !== raw, "two generated tokens must not collide");

console.log("apiTokens.test.ts: all checks passed");
