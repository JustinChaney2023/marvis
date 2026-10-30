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

// project tags, bare durations, bang priority
{
  const r = parseQuickCapture("Essay draft #intro-writing 1.5h !!", now);
  assert.equal(r.title, "Essay draft");
  assert.equal(r.projectName, "intro writing");
  assert.equal(r.durationMin, 90);
  assert.equal(r.priority, 2);
  assert.equal(r.dueAt, null);
}
{
  const r = parseQuickCapture("Gym 1h30m", now);
  assert.equal(r.title, "Gym");
  assert.equal(r.durationMin, 90);
}
// a number + spaced unit inside a title isn't a duration
{
  const r = parseQuickCapture("Watch 2 hour lecture", now);
  assert.equal(r.durationMin, null);
}

// bare weekday: next occurrence, today counts (now is a Wednesday)
{
  const r = parseQuickCapture("Lab report due friday", now);
  assert.equal(r.title, "Lab report");
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 21);
  assert.equal(r.hasTime, false);
}
{
  const r = parseQuickCapture("Club meeting wednesday 6pm", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 19);
  assert.equal(r.dueAt.getHours(), 18);
  assert.equal(r.hasTime, true);
}

// month/day forms, rolling into next year when already past
{
  const r = parseQuickCapture("Pay rent sep 1st", now);
  assert.equal(r.title, "Pay rent");
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getMonth(), 8);
  assert.equal(r.dueAt.getDate(), 1);
  assert.equal(r.dueAt.getFullYear(), 2026);
}
{
  const r = parseQuickCapture("Taxes 4/15", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getFullYear(), 2027);
  assert.equal(r.dueAt.getMonth(), 3);
}
{
  const r = parseQuickCapture("Trip 3 dec at 14:30", now);
  assert.equal(r.title, "Trip");
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getMonth(), 11);
  assert.equal(r.dueAt.getHours(), 14);
  assert.equal(r.dueAt.getMinutes(), 30);
}

// next week -> the coming Monday; tonight -> 8pm
{
  const r = parseQuickCapture("Plan sprint next week", now);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDay(), 1);
  assert.equal(r.dueAt.getDate(), 24);
}
{
  const r = parseQuickCapture("Read chapter tonight", now);
  assert.equal(r.title, "Read chapter");
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getHours(), 20);
}

// explicit timeZone: wall-clock in that zone, independent of the runtime's
{
  const instant = new Date("2026-08-19T14:00:00Z"); // 10:00 in New York
  const r = parseQuickCapture("Call mom tomorrow 3pm", instant, "America/New_York");
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.toISOString(), "2026-08-20T19:00:00.000Z");
  const late = new Date("2026-08-20T03:00:00Z"); // still the 19th, 11pm in New York
  const r2 = parseQuickCapture("Thing today 9am", late, "America/New_York");
  assert.equal(r2.dueAt?.toISOString(), "2026-08-19T13:00:00.000Z");
}

// short weekday names; sat/sun only with a lead-in word
{
  const r = parseQuickCapture("Essay draft fri 3pm", now);
  assert.equal(r.title, "Essay draft");
  assert.equal(r.dueAt?.getDate(), 21);
  assert.equal(r.dueAt?.getHours(), 15);
}
{
  const r = parseQuickCapture("Quiz next tues", now);
  assert.equal(r.title, "Quiz");
  assert.equal(r.dueAt?.getDate(), 25);
}
{
  const r = parseQuickCapture("SAT prep", now);
  assert.equal(r.title, "SAT prep");
  assert.equal(r.dueAt, null);
}
{
  const r = parseQuickCapture("Laundry on sat", now);
  assert.equal(r.title, "Laundry");
  assert.equal(r.dueAt?.getDay(), 6);
}
{
  // "thu" / "thurs" both work
  assert.equal(parseQuickCapture("Lab thurs", now).dueAt?.getDay(), 4);
  assert.equal(parseQuickCapture("Lab thu", now).dueAt?.getDay(), 4);
}

console.log("quickCapture.test.ts: all checks passed");
