import assert from "node:assert/strict";
import { getTimeZoneOffsetMinutes, getZonedWeekday, zonedWallTimeToUtc } from "./timezone";

// 2026-01-15 is standard time (winter) in the US: EST = UTC-5.
{
  const offset = getTimeZoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York");
  assert.equal(offset, -300);
}

// 2026-07-15 is daylight time: EDT = UTC-4.
{
  const offset = getTimeZoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/New_York");
  assert.equal(offset, -240);
}

// 9:00 AM in America/Chicago (UTC-6 in January) is 15:00 UTC.
{
  const utc = zonedWallTimeToUtc(2026, 1, 15, 9, 0, "America/Chicago");
  assert.equal(utc.toISOString(), "2026-01-15T15:00:00.000Z");
}

// Midnight UTC on 2026-08-21 is still 2026-08-20 evening in America/Los_Angeles.
{
  const weekday = getZonedWeekday(new Date("2026-08-21T02:00:00Z"), "America/Los_Angeles");
  // 2026-08-20 is a Thursday (4); the same UTC instant in UTC itself is Friday (5).
  assert.equal(weekday, 4);
}

console.log("timezone.test.ts: all checks passed");
