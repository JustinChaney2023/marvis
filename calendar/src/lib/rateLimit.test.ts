import assert from "node:assert/strict";
import { createRateLimiter } from "./rateLimit";

// Under the limit -> never blocked.
{
  const isLimited = createRateLimiter(3, 1000);
  assert.equal(isLimited("a"), false);
  assert.equal(isLimited("a"), false);
  assert.equal(isLimited("a"), false);
}

// Hits the limit -> blocked from the (limit+1)th attempt onward.
{
  const isLimited = createRateLimiter(3, 1000);
  isLimited("b");
  isLimited("b");
  isLimited("b");
  assert.equal(isLimited("b"), true, "4th attempt within the window is blocked");
  assert.equal(isLimited("b"), true, "stays blocked on further attempts");
}

// Keys are independent — one caller's attempts don't count against another.
{
  const isLimited = createRateLimiter(1, 1000);
  isLimited("c");
  assert.equal(isLimited("c"), true, "second attempt for c is blocked");
  assert.equal(isLimited("d"), false, "a different key is unaffected");
}

// The window slides — attempts older than windowMs stop counting.
async function main() {
  const isLimited = createRateLimiter(1, 50);
  isLimited("e");
  assert.equal(isLimited("e"), true, "blocked immediately within the window");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(isLimited("e"), false, "unblocked once the window has slid past the old attempt");

  console.log("rateLimit.test.ts: all checks passed");
}

main();
