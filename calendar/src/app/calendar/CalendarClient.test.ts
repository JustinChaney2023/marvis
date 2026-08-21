import assert from "node:assert/strict";
import { layoutAllDayEvents, layoutOverlappingEvents } from "./CalendarClient";

function ev(id: string, startHour: number, endHour: number) {
  return {
    id,
    masterId: id,
    title: id,
    start: new Date(2026, 7, 17, startHour, 0),
    end: new Date(2026, 7, 17, endHour, 0),
    isRecurring: false,
    recurrenceRule: null,
    locked: false,
    allDay: false,
    projectColor: null,
    taskPriority: null,
    meetingUrl: null,
    eventType: "DEFAULT" as const,
    reminderMinutes: null,
  };
}

// Multi-day all-day event, given as [startDay, endDay) (end exclusive,
// same convention as the DB: Event.end for a 3-day trip is midnight of
// the day after it's back).
function allDayEv(id: string, startDay: number, endDay: number) {
  return {
    ...ev(id, 0, 0),
    start: new Date(2026, 7, startDay),
    end: new Date(2026, 7, endDay),
    allDay: true,
  };
}

function week(startDay: number) {
  return Array.from({ length: 7 }, (_, i) => new Date(2026, 7, startDay + i));
}

// Two overlapping events share a 2-column cluster; a separate later event
// gets its own 1-column cluster.
{
  const events = [ev("a", 9, 10), ev("b", 9, 10), ev("c", 11, 12)];
  const placed = layoutOverlappingEvents(events);
  const byId = new Map(placed.map((p) => [p.event.id, p]));
  assert.equal(byId.get("a")!.cols, 2);
  assert.equal(byId.get("b")!.cols, 2);
  assert.notEqual(byId.get("a")!.col, byId.get("b")!.col);
  assert.equal(byId.get("c")!.cols, 1);
  assert.equal(byId.get("c")!.col, 0);
}

// Stress test: many separate (non-overlapping) clusters — the layout
// function used to scan the whole accumulated result array per cluster
// (cluster.includes(...)), which scaled roughly O(n^2) and got visibly
// slow on a busy calendar (GitHub issue #22). This should stay fast even
// at a count well beyond a realistic busy day.
{
  const events = Array.from({ length: 2000 }, (_, i) => ({
    ...ev(`e${i}`, 0, 1),
    start: new Date(2026, 7, 17, 0, 0, i * 2), // each its own tiny non-overlapping cluster
    end: new Date(2026, 7, 17, 0, 0, i * 2 + 1),
  }));
  const started = performance.now();
  const placed = layoutOverlappingEvents(events);
  const elapsedMs = performance.now() - started;
  assert.equal(placed.length, 2000);
  assert.ok(elapsedMs < 500, `layoutOverlappingEvents took ${elapsedMs}ms for 2000 disjoint events — expected well under 500ms`);
}

// layoutAllDayEvents: a 3-day trip (Aug 17-19, i.e. end-exclusive Aug 20)
// spans one continuous bar across those three columns of a Mon(17)-start
// week, not three separate one-day fragments.
{
  const days = week(17);
  const placements = layoutAllDayEvents([allDayEv("trip", 17, 20)], days);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].col, 0);
  assert.equal(placements[0].span, 3);
  assert.equal(placements[0].track, 0);
}

// Clamped at both ends when the trip runs off the edges of the visible
// week — it should still show one bar spanning the whole visible width,
// not extend past it or disappear.
{
  const days = week(17); // Aug 17-23
  const placements = layoutAllDayEvents([allDayEv("trip", 15, 30)], days);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].col, 0);
  assert.equal(placements[0].span, 7);
}

// Two overlapping multi-day events stack into separate tracks instead of
// colliding; a third, non-overlapping one reuses the first freed track.
{
  const days = week(17);
  const placements = layoutAllDayEvents(
    [allDayEv("a", 17, 20), allDayEv("b", 18, 21), allDayEv("c", 21, 23)],
    days,
  );
  const byId = new Map(placements.map((p) => [p.event.id, p]));
  assert.notEqual(byId.get("a")!.track, byId.get("b")!.track);
  assert.equal(byId.get("c")!.track, byId.get("a")!.track); // "a" ended before "c" starts
}

console.log("CalendarClient.test.ts: all checks passed");
