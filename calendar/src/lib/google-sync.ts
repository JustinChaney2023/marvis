import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getAuthorizedClient } from "@/lib/google-auth";
import { parseYMD, formatYMD } from "@/lib/calendar-dates";

const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 90;
// Google requires an explicit IANA zone on recurring events (it expands
// the RRULE server-side in that zone) — the app has no per-user timezone
// setting, so this assumes the machine's local zone is the user's.
const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
 * Also deletes local rows whose Google counterpart came back
 * status: "cancelled" (showDeleted: true) — a deletion made directly on
 * Google, not through this app, removes the local copy on the next sync.
 */
export async function importFromGoogle(userId: string) {
  const auth = await getAuthorizedClient(userId);
  if (!auth) return { imported: 0, deleted: 0 };
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
    // Without this, Google silently omits cancelled items from the
    // window instead of returning them with status: "cancelled" — the
    // only way to see a Google-side deletion at all.
    showDeleted: true,
  });

  const items = res.data.items ?? [];
  let imported = 0;
  let deleted = 0;
  for (const item of items) {
    try {
      if (!item.id) continue;
      if (item.status === "cancelled") {
        // Deleted directly on Google (not through this app) — remove the
        // local copy so it doesn't linger here after being gone on
        // Google. Scoped by googleEventId (unique), so this can never
        // touch a LOCAL-sourced event.
        const { count } = await prisma.event.deleteMany({
          where: { googleEventId: item.id },
        });
        deleted += count;
        continue;
      }
      // singleEvents: false returns recurring masters, but also leaks
      // exception instances (a moved/edited single occurrence) as
      // separate items carrying recurringEventId. Importing those as
      // standalone events double-shows the occurrence (once from the
      // master's RRULE expansion, once as this row) and — worse — would
      // get exported back as a bogus edit to the master. Full EXDATE/
      // per-instance override support is a bigger feature; skipping them
      // is the safe subset for now.
      if (item.recurringEventId) continue;
      if (!item.start || !item.end) continue;
      const startRaw = item.start.dateTime ?? item.start.date;
      const endRaw = item.end.dateTime ?? item.end.date;
      if (!startRaw || !endRaw) continue;
      const allDay = !item.start.dateTime;
      // Date-only fields ("2026-08-13") are a wall-clock date, not a UTC
      // instant — `new Date(str)` parses them as UTC midnight, which
      // renders a day early west of UTC. parseYMD parses as local midnight.
      const start = allDay ? parseYMD(startRaw) : new Date(startRaw);
      const end = allDay ? parseYMD(endRaw) : new Date(endRaw);

      await prisma.event.upsert({
        where: { googleEventId: item.id },
        create: {
          userId,
          title: item.summary ?? "(untitled)",
          start,
          end,
          allDay,
          recurrenceRule: extractRRule(item.recurrence),
          source: "GOOGLE",
          googleEventId: item.id,
          googleUpdatedAt: item.updated ? new Date(item.updated) : new Date(),
        },
        update: {
          title: item.summary ?? "(untitled)",
          start,
          end,
          allDay,
          recurrenceRule: extractRRule(item.recurrence),
          googleUpdatedAt: item.updated ? new Date(item.updated) : new Date(),
        },
      });
      imported++;
    } catch (err) {
      // One bad item shouldn't sink the rest of the batch.
      console.error(`importFromGoogle: skipping item ${item.id}:`, err);
    }
  }

  await prisma.googleAccount.update({
    where: { id: auth.account.id },
    data: { lastSyncedAt: new Date() },
  });

  return { imported, deleted };
}

/**
 * Pushes local events that are new (no googleEventId yet) or have been
 * locally edited since the last push (localDirty) to the connected
 * Google calendar. Deliberately NOT based on updatedAt > googleUpdatedAt
 * — @updatedAt bumps on every write including this function's own
 * bookkeeping and importFromGoogle's upserts, which made every row look
 * permanently dirty regardless of any real local edit.
 */
export async function exportToGoogle(userId: string) {
  const auth = await getAuthorizedClient(userId);
  if (!auth) return { exported: 0 };
  const calendar = google.calendar({ version: "v3", auth: auth.client });

  const all = await prisma.event.findMany({ where: { userId } });
  const toPush = all.filter((e) => !e.googleEventId || e.localDirty);

  let exported = 0;
  for (const event of toPush) {
    try {
      const body = {
        summary: event.title,
        start: event.allDay
          ? { date: formatYMD(event.start) }
          : { dateTime: event.start.toISOString(), timeZone: LOCAL_TIMEZONE },
        end: event.allDay
          ? { date: formatYMD(event.end) }
          : { dateTime: event.end.toISOString(), timeZone: LOCAL_TIMEZONE },
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
            localDirty: false,
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
            localDirty: false,
            googleEventId: created.data.id ?? undefined,
            googleUpdatedAt: created.data.updated
              ? new Date(created.data.updated)
              : new Date(),
          },
        });
      }
      exported++;
    } catch (err) {
      const status = (err as { code?: number; response?: { status?: number } })
        ?.response?.status ?? (err as { code?: number })?.code;
      if (status === 404 || status === 410) {
        // Deleted on Google's side — without this the same event fails
        // the same way on every future sync, permanently blocking every
        // event after it in the batch.
        await prisma.event.delete({ where: { id: event.id } });
        console.error(`exportToGoogle: ${event.id} gone on Google, deleted locally`);
      } else {
        console.error(`exportToGoogle: skipping ${event.id}:`, err);
      }
    }
  }

  return { exported };
}

/** Push local deletion of a Google-linked event before its row is removed. */
export async function deleteFromGoogle(userId: string, googleEventId: string) {
  const auth = await getAuthorizedClient(userId);
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

export async function syncGoogleCalendar(userId: string) {
  const exportResult = await exportToGoogle(userId);
  const importResult = await importFromGoogle(userId);
  return { ...exportResult, ...importResult };
}
