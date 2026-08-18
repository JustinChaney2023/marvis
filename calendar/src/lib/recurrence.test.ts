import assert from "node:assert/strict";
import {
  buildCustomWeeklyRule,
  expandEventOccurrences,
  parseCustomWeeklyDays,
} from "./recurrence";

// non-recurring event inside range -> one occurrence
{
  const occ = expandEventOccurrences(
    {
      id: "a",
      title: "Once",
      start: new Date(2026, 7, 17, 9, 0),
      end: new Date(2026, 7, 17, 9, 30),
      recurrenceRule: null,
      allDay: false,
    },
    new Date(2026, 7, 17, 0, 0),
    new Date(2026, 7, 18, 0, 0),
  );
  assert.equal(occ.length, 1);
  assert.equal(occ[0].id, "a");
  assert.equal(occ[0].isRecurring, false);
}

// non-recurring event outside range -> nothing
{
  const occ = expandEventOccurrences(
    {
      id: "a",
      title: "Once",
      start: new Date(2026, 7, 17, 9, 0),
      end: new Date(2026, 7, 17, 9, 30),
      recurrenceRule: null,
      allDay: false,
    },
    new Date(2026, 7, 20, 0, 0),
    new Date(2026, 7, 21, 0, 0),
  );
  assert.equal(occ.length, 0);
}

// weekly recurrence, 30-min event, expanded over 3 weeks -> 3 occurrences,
// same weekday/time, duration preserved, ids distinct and traceable to master
{
  const start = new Date(2026, 7, 17, 9, 0); // Monday
  const occ = expandEventOccurrences(
    {
      id: "m1",
      title: "Standup",
      start,
      end: new Date(2026, 7, 17, 9, 30),
      recurrenceRule: "FREQ=WEEKLY",
      allDay: false,
    },
    new Date(2026, 7, 17, 0, 0),
    new Date(2026, 8, 7, 0, 0), // 3 weeks later
  );
  assert.equal(occ.length, 3);
  const days = occ.map((o) => o.start.getDate());
  assert.deepEqual(days, [17, 24, 31]);
  for (const o of occ) {
    assert.equal(o.masterId, "m1");
    assert.notEqual(o.id, "m1");
    assert.equal(o.start.getHours(), 9);
    assert.equal((o.end.getTime() - o.start.getTime()) / 60000, 30);
    assert.equal(o.isRecurring, true);
  }
}

// occurrence that started before rangeStart but still overlaps it -> included
{
  const occ = expandEventOccurrences(
    {
      id: "m2",
      title: "Long block",
      start: new Date(2026, 7, 17, 23, 0),
      end: new Date(2026, 7, 18, 1, 0), // spans midnight into the 18th
      recurrenceRule: "FREQ=DAILY",
      allDay: false,
    },
    new Date(2026, 7, 18, 0, 0),
    new Date(2026, 7, 19, 0, 0),
  );
  assert.ok(occ.some((o) => o.start.getDate() === 17 && o.end.getDate() === 18));
}

// buildCustomWeeklyRule: canonical Sun-Sat order regardless of input order
{
  assert.equal(buildCustomWeeklyRule(["FR", "MO", "WE"]), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.equal(buildCustomWeeklyRule([]), "FREQ=WEEKLY");
}

// parseCustomWeeklyDays round-trips with buildCustomWeeklyRule
{
  const rule = buildCustomWeeklyRule(["SA", "MO"]);
  assert.deepEqual(parseCustomWeeklyDays(rule), ["MO", "SA"]);
}

// parseCustomWeeklyDays rejects plain presets and unrelated rules
{
  assert.equal(parseCustomWeeklyDays("FREQ=WEEKLY"), null);
  assert.equal(parseCustomWeeklyDays("FREQ=DAILY"), null);
  assert.equal(parseCustomWeeklyDays(null), null);
  assert.equal(parseCustomWeeklyDays("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"), null);
}

console.log("recurrence.test.ts: all checks passed");
