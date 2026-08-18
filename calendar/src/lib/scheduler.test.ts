import assert from "node:assert/strict";
import { findEarliestSlot } from "./scheduler";

// Monday 2026-08-17 09:00 local
const from = new Date(2026, 7, 17, 9, 0);
const horizon = new Date(2026, 7, 31, 0, 0);

// no conflicts -> takes the very first slot
{
  const slot = findEarliestSlot(from, 30, [], horizon);
  assert.ok(slot);
  assert.equal(slot.start.getTime(), from.getTime());
  assert.equal(slot.end.getTime(), from.getTime() + 30 * 60_000);
}

// busy block right at `from` -> skips past it
{
  const busy = [{ start: from, end: new Date(2026, 7, 17, 10, 0) }];
  const slot = findEarliestSlot(from, 30, busy, horizon);
  assert.ok(slot);
  assert.equal(slot.start.getTime(), new Date(2026, 7, 17, 10, 0).getTime());
}

// too little room before end of workday -> rolls to next workday's 9am
{
  const lateStart = new Date(2026, 7, 17, 17, 45); // 15 min left in the day
  const slot = findEarliestSlot(lateStart, 30, [], horizon);
  assert.ok(slot);
  assert.equal(slot.start.getTime(), new Date(2026, 7, 18, 9, 0).getTime());
}

// starting on a weekend -> rolls to Monday
{
  const saturday = new Date(2026, 7, 22, 9, 0); // 2026-08-22 is a Saturday
  const slot = findEarliestSlot(saturday, 30, [], horizon);
  assert.ok(slot);
  assert.equal(slot.start.getDay(), 1);
}

// nothing fits before horizon -> null
{
  const slot = findEarliestSlot(from, 30, [], from);
  assert.equal(slot, null);
}

console.log("scheduler.test.ts: all checks passed");
