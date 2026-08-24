import assert from "node:assert/strict";
import {
  computeRange,
  dayWeekdayLabel,
  defaultNewEventTimes,
  HOUR_END,
  HOUR_START,
  overlapsDay,
  startOfWeek,
} from "./calendar-dates";

// Normal daytime case: rounds up to the next 30-min mark, no clamping.
{
  const { start, end } = defaultNewEventTimes(new Date(2026, 7, 18, 10, 12));
  assert.equal(start.getHours(), 10);
  assert.equal(start.getMinutes(), 30);
  assert.equal(end.getTime() - start.getTime(), 30 * 60_000);
}

// The grid is now the full 24h (HOUR_START 0 / HOUR_END 24, so the
// clamp below is a no-op) — this used to be the "4am gets clamped to
// HOUR_START" case back when the grid was 6am-10pm; now 4am is a normal
// in-window time and should round up within the same day, unclamped.
{
  const { start } = defaultNewEventTimes(new Date(2026, 7, 18, 4, 0));
  assert.equal(start.getDate(), 18);
  assert.equal(start.getHours(), 4);
}

// Same story at the old HOUR_END boundary (10pm) — no longer clamped to
// the next day since the grid now runs all 24 hours.
{
  const { start } = defaultNewEventTimes(new Date(2026, 7, 18, 23, 0));
  assert.equal(start.getDate(), 18);
  assert.equal(start.getHours(), 23);
}

// Midnight-wrap: rounding up from 23:31-23:59 crosses into the next
// day. The bug this guards against: naively `% 24`ing the rounded hour
// back to 0 gave "today at 00:00" — in the PAST relative to `now` —
// instead of tomorrow. Must land on tomorrow's HOUR_START, not today.
{
  const { start } = defaultNewEventTimes(new Date(2026, 7, 18, 23, 45));
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

// overlapsDay: the bug that motivated this — a multi-day all-day event
// ("Fairbanks", Aug 13 -> Aug 18) must overlap every day in its span, not
// just its start day, which is what a plain isSameDay(event.start, day)
// check (the old logic) would wrongly limit it to.
{
  const trip = {
    start: new Date(2026, 7, 13, 0, 0),
    end: new Date(2026, 7, 18, 0, 0),
  };
  assert.equal(overlapsDay(trip, new Date(2026, 7, 13)), true);
  assert.equal(overlapsDay(trip, new Date(2026, 7, 15)), true); // middle day
  assert.equal(overlapsDay(trip, new Date(2026, 7, 17)), true); // last real day
  assert.equal(overlapsDay(trip, new Date(2026, 7, 18)), false); // exclusive end
  assert.equal(overlapsDay(trip, new Date(2026, 7, 12)), false);
  assert.equal(overlapsDay(trip, new Date(2026, 7, 19)), false);
}

// a same-day timed event still matches only its own day
{
  const meeting = {
    start: new Date(2026, 7, 20, 14, 0),
    end: new Date(2026, 7, 20, 15, 0),
  };
  assert.equal(overlapsDay(meeting, new Date(2026, 7, 20)), true);
  assert.equal(overlapsDay(meeting, new Date(2026, 7, 19)), false);
  assert.equal(overlapsDay(meeting, new Date(2026, 7, 21)), false);
}

// startOfWeek — Sunday is day 1 of the week, everywhere in the app
{
  const wednesday = new Date(2026, 7, 19); // Aug 19, 2026 is a Wednesday
  const sunday = startOfWeek(wednesday);
  assert.equal(sunday.getDay(), 0);
  assert.equal(sunday.getDate(), 16); // the Sunday before that Wednesday

  // a Sunday is already the start of its own week
  assert.equal(startOfWeek(sunday).getTime(), sunday.getTime());
}

// computeRange — week/month views both start their day list on Sunday
{
  const week = computeRange("week", new Date(2026, 7, 19));
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].getDay(), 0);
  assert.equal(week.days[6].getDay(), 6);

  const month = computeRange("month", new Date(2026, 7, 19));
  assert.equal(month.days[0].getDay(), 0);
  assert.equal(month.days[month.days.length - 1].getDay(), 6);
}

// dayWeekdayLabel matches the same Sunday-first convention
{
  assert.equal(dayWeekdayLabel(new Date(2026, 7, 16)), "Sun");
  assert.equal(dayWeekdayLabel(new Date(2026, 7, 19)), "Wed");
  assert.equal(dayWeekdayLabel(new Date(2026, 7, 22)), "Sat");
}

console.log("calendar-dates.test.ts: all checks passed");
