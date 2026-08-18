import assert from "node:assert/strict";
import { defaultNewEventTimes, HOUR_END, HOUR_START } from "./calendar-dates";

// Normal daytime case: rounds up to the next 30-min mark, no clamping.
{
  const { start, end } = defaultNewEventTimes(new Date(2026, 7, 18, 10, 12));
  assert.equal(start.getHours(), 10);
  assert.equal(start.getMinutes(), 30);
  assert.equal(end.getTime() - start.getTime(), 30 * 60_000);
}

// The bug this file exists to catch: "+ New event" at 4am (before
// HOUR_START) used to create a real event that rendered nowhere on the
// hour grid — clicking it looked completely broken with no error anywhere.
{
  const { start } = defaultNewEventTimes(new Date(2026, 7, 18, 4, 0));
  assert.equal(start.getDate(), 18);
  assert.equal(start.getHours(), HOUR_START);
}

// Late night (after HOUR_END) rolls to next day's HOUR_START, not today
// at an hour that still wouldn't render.
{
  const { start } = defaultNewEventTimes(new Date(2026, 7, 18, 23, 0));
  assert.equal(start.getDate(), 19);
  assert.equal(start.getHours(), HOUR_START);
}

// Right at the boundaries: HOUR_START itself is fine as-is, HOUR_END
// itself must roll (grid's window is [HOUR_START, HOUR_END)).
{
  const atStart = defaultNewEventTimes(new Date(2026, 7, 18, HOUR_START, 0));
  assert.equal(atStart.start.getDate(), 18);
  assert.equal(atStart.start.getHours(), HOUR_START);

  const atEnd = defaultNewEventTimes(new Date(2026, 7, 18, HOUR_END, 0));
  assert.equal(atEnd.start.getDate(), 19);
  assert.equal(atEnd.start.getHours(), HOUR_START);
}

console.log("calendar-dates.test.ts: all checks passed");
