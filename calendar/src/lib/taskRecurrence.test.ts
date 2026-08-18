import assert from "node:assert/strict";
import { nextTaskOccurrence } from "./taskRecurrence";

// weekly -> exactly 7 days later, same time
{
  const due = new Date(2026, 7, 17, 9, 0); // Monday
  const next = nextTaskOccurrence("FREQ=WEEKLY", due);
  assert.ok(next);
  assert.equal(next.getDate(), 24);
  assert.equal(next.getHours(), 9);
}

// daily -> next calendar day
{
  const due = new Date(2026, 7, 17, 18, 0);
  const next = nextTaskOccurrence("FREQ=DAILY", due);
  assert.ok(next);
  assert.equal(next.getDate(), 18);
}

// custom weekly BYDAY -> the next matching weekday, not just +7 days
{
  const monday = new Date(2026, 7, 17, 9, 0);
  const next = nextTaskOccurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR", monday);
  assert.ok(next);
  assert.equal(next.getDay(), 3); // Wednesday
  assert.equal(next.getDate(), 19);
}

// a rule with an UNTIL already in the past -> no further occurrence
{
  const due = new Date(2026, 7, 17, 9, 0);
  const next = nextTaskOccurrence("FREQ=DAILY;UNTIL=20260101T000000Z", due);
  assert.equal(next, null);
}

console.log("taskRecurrence.test.ts: all checks passed");
