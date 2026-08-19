import assert from "node:assert/strict";
import { layoutOverlappingEvents } from "./CalendarClient";

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
  };
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

console.log("CalendarClient.test.ts: all checks passed");
