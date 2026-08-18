import assert from "node:assert/strict";
import { dateKey, findBestSlot, findEarliestSlot } from "./scheduler";

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

// findBestSlot: HIGH-energy task, morning window (9am-12pm) is fully busy
// and no later same-day candidate matches it either (bounded scan, doesn't
// search indefinitely) -> falls back to the earliest available slot
// rather than returning nothing or an arbitrarily-delayed one.
{
  const busy = [
    { start: new Date(2026, 7, 17, 9, 0), end: new Date(2026, 7, 17, 14, 0) },
  ];
  const slot = findBestSlot(
    { durationMin: 30, dueAt: null, energy: "HIGH" },
    busy,
    horizon,
    from,
  );
  assert.ok(slot);
  assert.equal(slot.start.getDate(), 17);
  assert.equal(slot.start.getHours(), 14);
}

// findBestSlot: HIGH-energy task, morning window open the very next
// available day -> does reach it (not stuck on the bounded scan's first
// few same-day candidates) when the match is within CANDIDATE_LIMIT.
{
  const busy = [
    {
      start: new Date(2026, 7, 17, 9, 0),
      end: new Date(2026, 7, 18, 9, 0),
    },
  ];
  const slot = findBestSlot(
    { durationMin: 30, dueAt: null, energy: "HIGH" },
    busy,
    horizon,
    from,
  );
  assert.ok(slot);
  assert.equal(slot.start.getDate(), 18);
  assert.equal(slot.start.getHours(), 9);
}

// findBestSlot: MEDIUM energy (whole work day preferred) -> behaves like
// plain earliest-fit, since the very first candidate already matches.
{
  const slot = findBestSlot(
    { durationMin: 30, dueAt: null, energy: "MEDIUM" },
    [],
    horizon,
    from,
  );
  assert.ok(slot);
  assert.equal(slot.start.getTime(), from.getTime());
}

// findBestSlot: the energy window is already fully busy for the day, but
// later same-day slots are open and before the due date -> must not chase
// an unreachable energy match into the next day when a same-day,
// before-due option exists.
{
  const dueAt = new Date(2026, 7, 17, 14, 0);
  const busy = [
    { start: new Date(2026, 7, 17, 9, 0), end: new Date(2026, 7, 17, 12, 0) },
  ];
  const slot = findBestSlot(
    { durationMin: 30, dueAt, energy: "HIGH" },
    busy,
    horizon,
    from,
  );
  assert.ok(slot);
  assert.equal(slot.start.getDate(), 17);
  assert.ok(slot.start.getTime() <= dueAt.getTime());
}

// findBestSlot: project-day clustering. Same-day slots are open every day
// this week (no busy conflicts), so without clustering the earliest slot
// (today) always wins. With a sibling same-project event already on
// Wednesday, the scheduler should skip two otherwise-equally-good days to
// land on Wednesday instead — the specific complaint researched was tasks
// from the same project getting scattered instead of batched together.
{
  const monday = new Date(2026, 7, 17, 9, 0);
  const wednesday = new Date(2026, 7, 19, 9, 0);

  const withoutClustering = findBestSlot(
    { durationMin: 30, dueAt: null, energy: "MEDIUM" },
    [],
    horizon,
    monday,
  );
  assert.ok(withoutClustering);
  assert.equal(withoutClustering.start.getTime(), monday.getTime());

  const withClustering = findBestSlot(
    { durationMin: 30, dueAt: null, energy: "MEDIUM" },
    [],
    horizon,
    monday,
    new Set([dateKey(wednesday)]),
  );
  assert.ok(withClustering);
  assert.equal(withClustering.start.getTime(), wednesday.getTime());
}

// findBestSlot: clustering must not sacrifice a genuinely better same-day
// slot for a worse cross-day one. LOW-energy task (prefers 13-18) whose
// project cluster day is the same day as `from` (Tuesday) — the day's
// earliest slot (9:00) isn't energy-matched, but 13:00 on that SAME day
// is both energy-matched AND the cluster day, so it must win over jumping
// to some other day that only offers an energy match. A prior version of
// this jumped a full day per rejected candidate and would have skipped
// the 13:00 slot entirely.
{
  const tuesday9am = new Date(2026, 7, 18, 9, 0);
  const tuesday1pm = new Date(2026, 7, 18, 13, 0);

  const slot = findBestSlot(
    { durationMin: 30, dueAt: null, energy: "LOW" },
    [],
    horizon,
    tuesday9am,
    new Set([dateKey(tuesday9am)]),
  );
  assert.ok(slot);
  assert.equal(slot.start.getTime(), tuesday1pm.getTime());
}

console.log("scheduler.test.ts: all checks passed");
