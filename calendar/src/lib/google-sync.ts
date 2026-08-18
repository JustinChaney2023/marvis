import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getAuthorizedClient } from "@/lib/google-auth";

const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 90;

function extractRRule(recurrence: string[] | null | undefined): string | null {
  if (!recurrence) return null;
  const rule = recurrence.find((r) => r.startsWith("RRULE:"));
  return rule ? rule.slice("RRULE:".length) : null;
}

/**
 * Pulls events from the connected Google calendar into local Event rows
 * tagged source: GOOGLE, upserted by googleEventId. Windowed (past 7 /
 * future 90 days), not a full-history sync. Recurring Google events are
 * fetched as their master (singleEvents: false) with the RRULE
 * translated into our own recurrenceRule format, so they get expanded by
 * src/lib/recurrence.ts the same as locally-created recurring events —
 * not imported as hundreds of individual occurrence rows.
 *
 * Known gap (v1): doesn't detect events deleted on the Google side
 * (would need showDeleted + tombstone handling) — only creates/updates.
 */
export async function importFromGoogle() {
  const auth = await getAuthorizedClient();
  if (!auth) return { imported: 0 };
  const calendar = google.calendar({ version: "v3", auth: auth.client });

  const timeMin = new Date(
    Date.now() - SYNC_PAST_DAYS * 86_400_000,
  ).toISOString();
  const timeMax = new Date(
    Date.now() + SYNC_FUTURE_DAYS * 86_400_000,
  ).toISOString();

  const res = await calendar.events.list({
    calendarId: auth.account.calendarId,
    timeMin,
    timeMax,
    singleEvents: false,
    maxResults: 250,
  });

  const items = res.data.items ?? [];
  let imported = 0;
  for (const item of items) {
    if (!item.id || item.status === "cancelled") continue;
    if (!item.start || !item.end) continue;
    const startRaw = item.start.dateTime ?? item.start.date;
    const endRaw = item.end.dateTime ?? item.end.date;
    if (!startRaw || !endRaw) continue;
    const allDay = !item.start.dateTime;

    await prisma.event.upsert({
      where: { googleEventId: item.id },
      create: {
        title: item.summary ?? "(untitled)",
        start: new Date(startRaw),
        end: new Date(endRaw),
        allDay,
        recurrenceRule: extractRRule(item.recurrence),
        source: "GOOGLE",
        googleEventId: item.id,
        googleUpdatedAt: item.updated ? new Date(item.updated) : new Date(),
      },
      update: {
        title: item.summary ?? "(untitled)",
        start: new Date(startRaw),
        end: new Date(endRaw),
        allDay,
        recurrenceRule: extractRRule(item.recurrence),
        googleUpdatedAt: item.updated ? new Date(item.updated) : new Date(),
      },
    });
    imported++;
  }

  await prisma.googleAccount.update({
    where: { id: auth.account.id },
    data: { lastSyncedAt: new Date() },
  });

  return { imported };
}

/**
 * Pushes local events that are new (no googleEventId yet) or have been
 * edited more recently than their last known Google state
 * (updatedAt > googleUpdatedAt) to the connected Google calendar.
 */
export async function exportToGoogle() {
  const auth = await getAuthorizedClient();
  if (!auth) return { exported: 0 };
  const calendar = google.calendar({ version: "v3", auth: auth.client });

  const all = await prisma.event.findMany();
  const toPush = all.filter(
    (e) =>
      !e.googleEventId ||
      !e.googleUpdatedAt ||
      e.updatedAt.getTime() > e.googleUpdatedAt.getTime(),
  );

  let exported = 0;
  for (const event of toPush) {
    const body = {
      summary: event.title,
      start: event.allDay
        ? { date: event.start.toISOString().slice(0, 10) }
        : { dateTime: event.start.toISOString() },
      end: event.allDay
        ? { date: event.end.toISOString().slice(0, 10) }
        : { dateTime: event.end.toISOString() },
      recurrence: event.recurrenceRule ? [`RRULE:${event.recurrenceRule}`] : undefined,
    };

    if (event.googleEventId) {
      const updated = await calendar.events.update({
        calendarId: auth.account.calendarId,
        eventId: event.googleEventId,
        requestBody: body,
      });
      await prisma.event.update({
        where: { id: event.id },
        data: {
          googleUpdatedAt: updated.data.updated
            ? new Date(updated.data.updated)
            : new Date(),
        },
      });
    } else {
      const created = await calendar.events.insert({
        calendarId: auth.account.calendarId,
        requestBody: body,
      });
      await prisma.event.update({
        where: { id: event.id },
        data: {
          googleEventId: created.data.id ?? undefined,
          googleUpdatedAt: created.data.updated
            ? new Date(created.data.updated)
            : new Date(),
        },
      });
    }
    exported++;
  }

  return { exported };
}

/** Push local deletion of a Google-linked event before its row is removed. */
export async function deleteFromGoogle(googleEventId: string) {
  const auth = await getAuthorizedClient();
  if (!auth) return;
  const calendar = google.calendar({ version: "v3", auth: auth.client });
  try {
    await calendar.events.delete({
      calendarId: auth.account.calendarId,
      eventId: googleEventId,
    });
  } catch (err) {
    // Already gone on Google's side, or offline — local deletion should
    // still proceed either way, so this is deliberately swallowed.
    console.error("deleteFromGoogle failed:", err);
  }
}

export async function syncGoogleCalendar() {
  const exportResult = await exportToGoogle();
  const importResult = await importFromGoogle();
  return { ...exportResult, ...importResult };
}
