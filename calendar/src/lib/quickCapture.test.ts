import assert from "node:assert/strict";
import { parseQuickCapture } from "./quickCapture";

// Wednesday 2026-08-19 10:00 local, for deterministic "next <weekday>" math.
const now = new Date(2026, 7, 19, 10, 0);

{
  const r = parseQuickCapture("Call dentist tomorrow 3pm p2", now);
  assert.equal(r.title, "Call dentist");
  assert.equal(r.priority, 2);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 20);
  assert.equal(r.dueAt.getHours(), 15);
}

{
  const r = parseQuickCapture("Water the plants today", now);
  assert.equal(r.title, "Water the plants");
  assert.equal(r.priority, 0);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 19);
  assert.equal(r.dueAt.getHours(), 0);
}

{
  const r = parseQuickCapture("Renew passport in 5 days", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 24);
}

// "next monday" from a Wednesday should be the coming Monday, 5 days out,
// not today even if today happened to be Monday (delta<=0 rolls to +7).
{
  const r = parseQuickCapture("Submit report next monday", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDay(), 1);
  assert.equal(r.dueAt.getDate(), 24);
}

// no recognizable date/time/priority -> title untouched, no due date
{
  const r = parseQuickCapture("Buy milk", now);
  assert.equal(r.title, "Buy milk");
  assert.equal(r.dueAt, null);
  assert.equal(r.priority, 0);
}

// time only, no date word -> defaults to today at that time
{
  const r = parseQuickCapture("Standup at 9:30am", now);
  assert.equal(r.title, "Standup");
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 19);
  assert.equal(r.dueAt.getHours(), 9);
  assert.equal(r.dueAt.getMinutes(), 30);
}

// 12am/12pm edge cases (midnight/noon)
{
  const r = parseQuickCapture("Backup job tonight at 12am", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getHours(), 0);
}
{
  const r = parseQuickCapture("Lunch at 12pm", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getHours(), 12);
}

// explicit duration for quick-add-event (#38)
{
  const r = parseQuickCapture("Lunch with Sam tomorrow 1pm for 1h", now);
  assert.equal(r.title, "Lunch with Sam");
  assert.equal(r.durationMin, 60);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getHours(), 13);
}
{
  const r = parseQuickCapture("Standup for 30 min", now);
  assert.equal(r.title, "Standup");
  assert.equal(r.durationMin, 30);
}
{
  const r = parseQuickCapture("Buy milk", now);
  assert.equal(r.durationMin, null);
}

console.log("quickCapture.test.ts: all checks passed");
