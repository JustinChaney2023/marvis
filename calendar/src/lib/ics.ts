import ICAL from "ical.js";

type IcsExportEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrenceRule: string | null;
  notes: string | null;
  location: string | null;
  // RFC 5545 EXDATE (#40's excludeDates) — occurrence starts to mark
  // excluded so a round-trip export/import doesn't resurrect an
  // occurrence the user specifically deleted/moved.
  excludeDates?: string | null;
};

// All-day dates are calendar dates, not instants — reading them via
// toISOString() (always UTC) shifts the date back a day for any server
// timezone east of UTC (e.g. a Sept-1 all-day event stored as local
// midnight becomes Aug-31T14:00Z in UTC+10, exporting as "Aug 31").
// Reading the local Y/M/D fields directly is timezone-agnostic.
function icsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
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
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`);
    if (event.excludeDates) {
      const exdates = event.excludeDates
        .split(",")
        .filter(Boolean)
        .map((iso) => icsDate(new Date(iso), event.allDay));
      if (exdates.length > 0) lines.push(`EXDATE:${exdates.join(",")}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrenceRule: string | null;
  notes: string | null;
  location: string | null;
  excludeDates: string | null;
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
    if (!event.uid || !event.startDate || !event.endDate) continue;
    const rruleProp = vevent.getFirstPropertyValue("rrule") as { toString(): string } | null;
    const exdateProps = vevent.getAllProperties("exdate");
    const excludeDates = exdateProps.length
      ? exdateProps
          .flatMap((prop) => prop.getValues() as { toJSDate(): Date }[])
          .map((v) => v.toJSDate().toISOString())
          .join(",")
      : null;
    events.push({
      uid: event.uid,
      title: event.summary || "(untitled)",
      start: event.startDate.toJSDate(),
      end: event.endDate.toJSDate(),
      allDay: event.startDate.isDate,
      recurrenceRule: rruleProp ? rruleProp.toString() : null,
      notes: event.description || null,
      location: event.location || null,
      excludeDates,
    });
  }
  return events;
}
