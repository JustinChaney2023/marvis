import assert from "node:assert/strict";
import { feedbackIssueContent } from "./githubIssues";

// Title is the first non-empty line, trimmed and capped.
{
  const { title, body, labels } = feedbackIssueContent({
    message: "\n  Let me drag tasks onto the calendar  \nmore details",
    category: "SUGGESTION",
    page: "/tasks",
  });
  assert.equal(title, "Let me drag tasks onto the calendar");
  assert.ok(body.includes("more details"));
  assert.ok(body.includes("`/tasks`"));
  assert.deepEqual(labels, ["season-feedback", "enhancement"]);
}

{
  const { title, labels } = feedbackIssueContent({ message: "x".repeat(200), category: "BUG", page: null });
  assert.equal(title.length, 80);
  assert.ok(title.endsWith("…"));
  assert.deepEqual(labels, ["season-feedback", "bug"]);
}

// OTHER gets no category label.
assert.deepEqual(feedbackIssueContent({ message: "hi", category: "OTHER", page: null }).labels, ["season-feedback"]);

console.log("githubIssues.test.ts: all checks passed");
