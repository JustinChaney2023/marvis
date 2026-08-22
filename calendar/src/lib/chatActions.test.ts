import assert from "node:assert";
import { ChatActionSchema, describeChatAction } from "./chatActions";

// Same formatting describeChatAction itself uses — computed here rather
// than hardcoded, so this test doesn't depend on the environment's TZ.
const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const dueAt = "2026-08-22T17:00:00.000Z";
assert.strictEqual(
  describeChatAction({ kind: "createTask", title: "Buy groceries", priority: "Medium", dueAt }),
  `Create task: "Buy groceries", Medium, due ${fmt(dueAt)}`,
);

const startIso = "2026-08-25T20:00:00.000Z";
assert.strictEqual(
  describeChatAction({ kind: "moveEvent", eventId: "evt1", title: "Dentist", startIso }),
  `Move "Dentist" to ${fmt(startIso)}`,
);

// deleteTask falls back to the id when no title was set
assert.strictEqual(describeChatAction({ kind: "deleteTask", taskId: "task1" }), 'Delete task "task1"');

// createEvent with a location
assert.strictEqual(
  describeChatAction({ kind: "createEvent", title: "Lunch", startIso, location: "Cafe Luna" }),
  `Create event: "Lunch", ${fmt(startIso)} at Cafe Luna`,
);

// A minimal valid action parses.
const parsed = ChatActionSchema.safeParse({ kind: "scheduleTask", taskId: "task1", title: "Write report" });
assert.ok(parsed.success);

// An unknown kind is rejected, not silently coerced.
const invalid = ChatActionSchema.safeParse({ kind: "wipeDatabase", title: "nope" });
assert.ok(!invalid.success);

console.log("chatActions.test.ts: all checks passed");
