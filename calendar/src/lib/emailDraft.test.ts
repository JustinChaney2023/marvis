import assert from "node:assert/strict";
import { firstNameForGreeting } from "./emailDraft";

assert.equal(firstNameForGreeting("Jane Smith"), "Jane");
assert.equal(firstNameForGreeting("Dr. Jane Smith"), "Jane", "strips a leading honorific");
assert.equal(firstNameForGreeting("Dr Jane Smith"), "Jane", "honorific without a period");
assert.equal(firstNameForGreeting("Professor Smith"), "Smith");
assert.equal(firstNameForGreeting(" Jane Smith"), "Jane", "leading whitespace doesn't produce an empty greeting");
assert.equal(firstNameForGreeting("Smith"), "Smith", "single-word name works as-is");
assert.equal(firstNameForGreeting("Dr. "), "Dr.", "an honorific with nothing else falls back to the original rather than an empty greeting");

console.log("emailDraft.test.ts: all checks passed");
