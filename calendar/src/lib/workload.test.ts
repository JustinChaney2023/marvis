import assert from "node:assert/strict";
import { dayLoads, estimateAccuracy, minutesWithin } from "./workload";

const at = (h: number, m = 0) => new Date(2026, 7, 17, h, m);
const window = { start: at(9), end: at(17) };

// Overlaps count once; time outside the window doesn't count.
assert.equal(
  minutesWithin(
    [
      { start: at(8), end: at(10) }, // 60 inside
      { start: at(9, 30), end: at(10, 30) }, // overlaps -> +30
      { start: at(16, 30), end: at(18) }, // 30 inside
    ],
    window,
  ),
  120,
);
assert.equal(minutesWithin([], window), 0);

// Meetings and task blocks are split; the daily cap lowers capacity.
{
  const [load] = dayLoads(
    [window],
    [
      { start: at(10), end: at(11), isTask: false, outOfOffice: false },
      { start: at(13), end: at(15), isTask: true, outOfOffice: false },
    ],
    360,
  );
  assert.equal(load.capacityMin, 360);
  assert.equal(load.meetingMin, 60);
  assert.equal(load.taskMin, 120);
  assert.equal(load.outOfOffice, false);
}
{
  const [load] = dayLoads(
    [window],
    [{ start: at(0), end: new Date(2026, 7, 18), isTask: false, outOfOffice: true }],
    null,
  );
  assert.equal(load.capacityMin, 480);
  assert.equal(load.outOfOffice, true);
}

// Estimates vs actual: only tasks with tracked time count.
{
  const acc = estimateAccuracy([
    { id: "a", title: "A", durationMin: 60, trackedMinutes: 90 },
    { id: "b", title: "B", durationMin: 60, trackedMinutes: 60 },
    { id: "c", title: "C", durationMin: 30, trackedMinutes: 0 },
    { id: "d", title: "D", durationMin: 120, trackedMinutes: 30 },
  ]);
  assert.equal(acc.count, 3);
  assert.equal(acc.estimateMin, 240);
  assert.equal(acc.actualMin, 180);
  assert.equal(acc.ratio, 0.75);
  assert.deepEqual(acc.biggestMisses.map((m) => m.id), ["d", "a"]);
}
assert.equal(estimateAccuracy([]).ratio, null);

console.log("workload.test.ts: all checks passed");
