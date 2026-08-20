import ICAL from "ical.js";

type IcsExportEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrenceRule: string | null;
  notes: string | null;
};

function icsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// Folds a line to the 75-octet limit RFC 5545 requires, continuation
// lines starting with a single space — most calendar apps tolerate
// unfolded lines, but writing this correctly costs nothing and avoids
// surprises importing into a stricter client.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

/** Builds a VCALENDAR document for one or more events (#33 — export). */
export function buildIcsCalendar(events: IcsExportEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Marvis Calendar//EN"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@marvis-calendar`);
    lines.push(`DTSTART${event.allDay ? ";VALUE=DATE" : ""}:${icsDate(event.start, event.allDay)}`);
    lines.push(`DTEND${event.allDay ? ";VALUE=DATE" : ""}:${icsDate(event.end, event.allDay)}`);
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`);
    if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export type ParsedIcsEvent = {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrenceRule: string | null;
  notes: string | null;
};

/**
 * Parses an uploaded .ics file's VEVENTs (#33 — import) — same ical.js
 * parsing apple-sync.ts already uses for CalDAV objects, just applied to
 * a whole multi-event file instead of one-object-at-a-time.
 */
export function parseIcsEvents(icsText: string): ParsedIcsEvent[] {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const events: ParsedIcsEvent[] = [];
  for (const vevent of comp.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    if (!event.startDate || !event.endDate) continue;
    const rruleProp = vevent.getFirstPropertyValue("rrule") as { toString(): string } | null;
    events.push({
      title: event.summary || "(untitled)",
      start: event.startDate.toJSDate(),
      end: event.endDate.toJSDate(),
      allDay: event.startDate.isDate,
      recurrenceRule: rruleProp ? rruleProp.toString() : null,
      notes: event.description || null,
    });
  }
  return events;
}
