import assert from "node:assert/strict";
import {
  buildCustomWeeklyRule,
  buildLocalRRule,
  expandEventOccurrences,
  parseCustomWeeklyDays,
  parseRecurrenceEndCondition,
  stripRecurrenceEndCondition,
  withRecurrenceEndCondition,
} from "./recurrence";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
    TZ,
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
    TZ,
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
    TZ,
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
    TZ,
  );
  assert.ok(occ.some((o) => o.start.getDate() === 17 && o.end.getDate() === 18));
}

// excludeDates (#40) suppresses just the matching occurrence, others unaffected
{
  const start = new Date(2026, 7, 17, 9, 0); // Monday
  const secondOccurrenceStart = new Date(2026, 7, 24, 9, 0);
  const occ = expandEventOccurrences(
    {
      id: "m1",
      title: "Standup",
      start,
      end: new Date(2026, 7, 17, 9, 30),
      recurrenceRule: "FREQ=WEEKLY",
      allDay: false,
      excludeDates: secondOccurrenceStart.toISOString(),
    },
    new Date(2026, 7, 17, 0, 0),
    new Date(2026, 8, 7, 0, 0), // 3 weeks later
    TZ,
  );
  const days = occ.map((o) => o.start.getDate());
  assert.deepEqual(days, [17, 31]);
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

// recurrenceEndsBefore (#54, "this and following"): the master stops
// generating occurrences at/after the cutoff, earlier ones stay intact.
{
  const start = new Date(2026, 7, 3, 9, 0); // Monday
  const cutoff = new Date(2026, 7, 17, 9, 0); // the 3rd occurrence
  const occ = expandEventOccurrences(
    {
      id: "m1",
      title: "Standup",
      start,
      end: new Date(2026, 7, 3, 9, 30),
      recurrenceRule: "FREQ=WEEKLY",
      allDay: false,
      recurrenceEndsBefore: cutoff,
    },
    new Date(2026, 7, 3, 0, 0),
    new Date(2026, 8, 7, 0, 0), // 5 weeks later
    TZ,
  );
  const days = occ.map((o) => o.start.getDate());
  assert.deepEqual(days, [3, 10]);
}

// recurrenceEndsBefore combines with excludeDates (a pre-existing
// exception before the cutoff still gets excluded from the old master).
{
  const start = new Date(2026, 7, 3, 9, 0);
  const excluded = new Date(2026, 7, 10, 9, 0);
  const cutoff = new Date(2026, 7, 17, 9, 0);
  const occ = expandEventOccurrences(
    {
      id: "m1",
      title: "Standup",
      start,
      end: new Date(2026, 7, 3, 9, 30),
      recurrenceRule: "FREQ=WEEKLY",
      allDay: false,
      excludeDates: excluded.toISOString(),
      recurrenceEndsBefore: cutoff,
    },
    new Date(2026, 7, 3, 0, 0),
    new Date(2026, 8, 7, 0, 0),
    TZ,
  );
  const days = occ.map((o) => o.start.getDate());
  assert.deepEqual(days, [3]);
}

// withRecurrenceEndCondition + parseRecurrenceEndCondition round-trip for "on"
{
  const rule = withRecurrenceEndCondition(
    "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    { mode: "on", onDateYMD: "2026-12-15" },
    TZ,
  );
  assert.match(rule, /^FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=\d{8}T\d{6}Z$/);
  const parsed = parseRecurrenceEndCondition(rule);
  assert.equal(parsed.mode, "on");
  assert.equal(parsed.mode === "on" && parsed.onDateYMD, "2026-12-15");
}

// count round-trip
{
  const rule = withRecurrenceEndCondition("FREQ=WEEKLY", { mode: "count", count: 12 }, TZ);
  assert.equal(rule, "FREQ=WEEKLY;COUNT=12");
  const parsed = parseRecurrenceEndCondition(rule);
  assert.equal(parsed.mode, "count");
  assert.equal(parsed.mode === "count" && parsed.count, 12);
}

// never = no-op
{
  const rule = withRecurrenceEndCondition("FREQ=DAILY", { mode: "never" }, TZ);
  assert.equal(rule, "FREQ=DAILY");
  assert.equal(parseRecurrenceEndCondition(rule).mode, "never");
  assert.equal(parseRecurrenceEndCondition(null).mode, "never");
}

// stripRecurrenceEndCondition undoes withRecurrenceEndCondition, so a
// saved rule can be re-matched against presets/custom-weekly for editing
{
  const base = "FREQ=WEEKLY;BYDAY=MO,WE,FR";
  const withUntil = withRecurrenceEndCondition(base, { mode: "on", onDateYMD: "2026-12-15" }, TZ);
  assert.equal(stripRecurrenceEndCondition(withUntil), base);
  assert.deepEqual(parseCustomWeeklyDays(stripRecurrenceEndCondition(withUntil)), parseCustomWeeklyDays(base));

  const withCount = withRecurrenceEndCondition(base, { mode: "count", count: 5 }, TZ);
  assert.equal(stripRecurrenceEndCondition(withCount), base);
}

// An "ends on" rule actually stops producing occurrences after the
// chosen local date — the real thing this feature is for. dtstart is a
// Monday; BYDAY=MO,WE,FR with UNTIL end-of-day on a later Friday should
// include that last Friday but nothing after it.
{
  const dtstart = new Date(2026, 7, 3, 9, 0); // Mon Aug 3 2026, 9:00 local
  const rule = withRecurrenceEndCondition(
    buildCustomWeeklyRule(["MO", "WE", "FR"]),
    { mode: "on", onDateYMD: "2026-08-14" }, // a Friday
    TZ,
  );
  const occurrences = buildLocalRRule(rule, dtstart, TZ).all();
  assert.ok(occurrences.length > 0);
  const last = occurrences[occurrences.length - 1];
  assert.equal(last.getFullYear(), 2026);
  assert.equal(last.getMonth(), 7);
  assert.equal(last.getDate(), 14);
  assert.ok(occurrences.every((d) => d.getTime() <= last.getTime()));
}

// COUNT=N produces exactly N occurrences
{
  const dtstart = new Date(2026, 7, 3, 9, 0);
  const rule = withRecurrenceEndCondition(
    buildCustomWeeklyRule(["MO", "WE", "FR"]),
    { mode: "count", count: 5 },
    TZ,
  );
  const occurrences = buildLocalRRule(rule, dtstart, TZ).all();
  assert.equal(occurrences.length, 5);
}

console.log("recurrence.test.ts: all checks passed");
