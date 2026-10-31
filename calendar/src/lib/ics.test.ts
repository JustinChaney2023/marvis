import assert from "node:assert/strict";
import { buildIcsCalendar, parseIcsEvents } from "./ics";

// Round-trip: build -> parse -> the parsed event matches what went in,
// including text that needs escaping (comma) and a recurrence rule.
{
  const start = new Date("2026-08-21T15:00:00Z");
  const end = new Date("2026-08-21T16:00:00Z");
  const ics = buildIcsCalendar([
    {
      id: "abc123",
      title: "Team sync, weekly",
      start,
      end,
      allDay: false,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=FR",
      notes: "Line1\nLine2",
      location: null,
    },
  ]);
  const [parsed] = parseIcsEvents(ics);
  assert.equal(parsed.title, "Team sync, weekly");
  assert.equal(parsed.start.getTime(), start.getTime());
  assert.equal(parsed.end.getTime(), end.getTime());
  assert.equal(parsed.recurrenceRule, "FREQ=WEEKLY;BYDAY=FR");
  assert.equal(parsed.notes, "Line1\nLine2");
}

// All-day export uses the event's own local calendar date, not a UTC
// slice of it — a local-midnight Date in a timezone east of UTC would
// otherwise export as the previous day.
{
  const localMidnight = new Date(2026, 8, 1); // Sept 1, local time
  const ics = buildIcsCalendar([
    {
      id: "allday1",
      title: "Holiday",
      start: localMidnight,
      end: new Date(2026, 8, 2),
      allDay: true,
      recurrenceRule: null,
      notes: null,
      location: null,
    },
  ]);
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260901"), ics);
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260902"), ics);
}

// excludeDates round-trips through EXDATE — a deleted/moved occurrence
// doesn't come back on export/import.
{
  const start = new Date("2026-08-17T09:00:00.000Z");
  const excluded = new Date("2026-08-24T09:00:00.000Z");
  const ics = buildIcsCalendar([
    {
      id: "series1",
      title: "Standup",
      start,
      end: new Date("2026-08-17T09:30:00.000Z"),
      allDay: false,
      recurrenceRule: "FREQ=WEEKLY",
      notes: null,
      location: null,
      excludeDates: excluded.toISOString(),
    },
  ]);
  assert.ok(ics.includes("EXDATE:"), ics);
  const [parsed] = parseIcsEvents(ics);
  assert.ok(parsed.excludeDates);
  assert.equal(new Date(parsed.excludeDates!.split(",")[0]).getTime(), excluded.getTime());
}

// A recurring series' modified-occurrence override (RECURRENCE-ID) shares
// its UID with the master. parseIcsEvents itself must keep BOTH (the
// one-off file-import caller doesn't dedupe by uid at all, so dropping the
// override there would just lose data) but flag the override via
// isRecurrenceException so a uid-deduping caller (calendarSubscriptions.ts)
// can filter it out itself.
{
  const masterVevent = [
    "BEGIN:VEVENT",
    "UID:series-with-override@example.com",
    "DTSTART:20260803T090000Z",
    "DTEND:20260803T093000Z",
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:Standup",
    "END:VEVENT",
  ].join("\r\n");
  const overrideVevent = [
    "BEGIN:VEVENT",
    "UID:series-with-override@example.com",
    "RECURRENCE-ID:20260810T090000Z",
    "DTSTART:20260810T100000Z",
    "DTEND:20260810T103000Z",
    "SUMMARY:Standup (moved)",
    "END:VEVENT",
  ].join("\r\n");
  const wrap = (body: string) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", body, "END:VCALENDAR"].join("\r\n");

  for (const [label, body] of [
    ["master first", [masterVevent, overrideVevent].join("\r\n")],
    ["override first", [overrideVevent, masterVevent].join("\r\n")],
  ] as const) {
    const parsed = parseIcsEvents(wrap(body));
    assert.equal(parsed.length, 2, `${label}: both the master and the override are returned`);
    const master = parsed.find((e) => !e.isRecurrenceException);
    const override = parsed.find((e) => e.isRecurrenceException);
    assert.ok(master, `${label}: the master is present and flagged isRecurrenceException: false`);
    assert.ok(override, `${label}: the override is present and flagged isRecurrenceException: true`);
    assert.equal(master.title, "Standup", `${label}: the master keeps its own data`);
    assert.equal(master.recurrenceRule, "FREQ=WEEKLY", `${label}: the series' RRULE is intact`);
    assert.equal(override.title, "Standup (moved)", `${label}: the override keeps its own data too`);
  }
}

console.log("ics.test.ts: all checks passed");
