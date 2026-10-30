import assert from "node:assert/strict";
import { formatEventLine, formatTaskLine } from "./scheduleChat";

{
  const line = formatEventLine({
    masterId: "evt1",
    start: new Date(2026, 7, 21, 15, 0),
    end: new Date(2026, 7, 21, 16, 0),
    title: "Team sync",
  });
  assert.ok(line.startsWith("- [evt1] "), line);
  assert.ok(line.endsWith(": Team sync"), line);
}

// scheduled (has an event) vs. unscheduled (no events)
{
  const scheduled = formatTaskLine({
    id: "t1",
    title: "Write report",
    project: { name: "Q3" },
    status: "IN_PROGRESS",
    events: [{}],
    dueAt: new Date(2026, 7, 25, 17, 0),
  });
  assert.ok(scheduled.includes(", scheduled"), scheduled);
  assert.ok(!scheduled.includes(", unscheduled"), scheduled);
  assert.ok(scheduled.includes("[Q3]"), scheduled);
  assert.ok(scheduled.includes("due "), scheduled);

  const unscheduled = formatTaskLine({
    id: "t2",
    title: "Read chapter",
    project: null,
    status: "TODO",
    events: [],
    dueAt: null,
  });
  assert.ok(unscheduled.includes(", unscheduled"), unscheduled);
  assert.ok(!unscheduled.includes("due "), unscheduled);
  assert.equal(unscheduled, "- [t2] Read chapter (todo, unscheduled)");
}

console.log("scheduleChat.test.ts: all checks passed");
