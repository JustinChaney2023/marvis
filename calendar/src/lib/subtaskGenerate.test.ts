import assert from "node:assert/strict";
import { cleanSubtasks } from "./subtaskGenerate";

assert.deepEqual(
  cleanSubtasks(["  Buy groceries ", "", "   ", "Call vendor"]),
  ["Buy groceries", "Call vendor"],
  "kept entries are trimmed, not just filtered",
);
assert.deepEqual(cleanSubtasks([]), []);
assert.deepEqual(cleanSubtasks(["one"]), ["one"]);

console.log("subtaskGenerate.test.ts: all checks passed");
