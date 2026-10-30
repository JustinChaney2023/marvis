import { google } from "googleapis";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthorizedClientForCalendar, listGoogleCalendarSubscriptions } from "@/lib/google-auth";
import { parseYMD, formatYMD } from "@/lib/calendar-dates";

const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 90;
// Google requires an explicit IANA zone on recurring events (it expands
// the RRULE server-side in that zone). Fallback only, for an account that
// hasn't had its own User.timezone (#46) set yet.
const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function extractRRule(recurrence: string[] | null | undefined): string | null {
  if (!recurrence) return null;
  const rule = recurrence.find((r) => r.startsWith("RRULE:"));
  return rule ? rule.slice("RRULE:".length) : null;
}

// Maps our Tailwind color-family names (src/lib/eventColors.ts) to
// Google Calendar's numeric event colorId palette, and back. Not a
// bijection — Google has 11 colors, we have 8 — so the reverse map
// covers all 11 while the forward map only needs one colorId per local
// color.
// Must cover every key in PROJECT_EVENT_COLORS (eventColors.ts) — Google
// Calendar only has 11 colorIds against our 13 local colors, so a few of
// these are nearest-match, not exact (there's no lossless 1:1 mapping).
export const LOCAL_TO_GOOGLE_COLOR: Record<string, string> = {
  zinc: "8", // Graphite
  red: "11", // Tomato
  amber: "5", // Banana
  green: "10", // Basil
  blue: "7", // Peacock
  indigo: "9", // Blueberry
  violet: "3", // Grape
  pink: "4", // Flamingo
  orange: "6", // Tangerine
  teal: "7", // Peacock (nearest match)
  sky: "9", // Blueberry (nearest match)
  emerald: "10", // Basil (nearest match)
  rose: "4", // Flamingo (nearest match)
};
const GOOGLE_TO_LOCAL_COLOR: Record<string, string> = {
  "1": "violet", // Lavender
  "2": "green", // Sage
  "3": "violet", // Grape
  "4": "pink", // Flamingo
  "5": "amber", // Banana
  "6": "amber", // Tangerine
  "7": "blue", // Peacock
  "8": "zinc", // Graphite
  "9": "indigo", // Blueberry
  "10": "green", // Basil
  "11": "red", // Tomato
};

// Per-item sync failures used to only ever reach console.error — a real
// failure (an expired/revoked token that still passes the coarse
// getAuthorizedClient check, an item Google rejects, a network blip)
// looked identical to "nothing needed syncing" from Settings' Sync
// button, since exported/imported just stayed 0 either way. Surface a
// short reason instead so a broken sync is at least visibly broken.
function describeGoogleError(err: unknown): string {
  const status =
    (err as { code?: number; response?: { status?: number } })?.response?.status ??
    (err as { code?: number })?.code;
  const message =
    (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
    (err instanceof Error ? err.message : String(err));
  return status ? `${status} ${message}` : message;
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
export async function importFromGoogle(googleCalendarId: string) {
  let auth;
  try {
    auth = await getAuthorizedClientForCalendar(googleCalendarId);
  } catch (err) {
    // Most commonly a dead refresh token (revoked access, or an
    // unverified-app test token that expired) — without this, one
    // account's auth failure threw straight out of syncGoogleCalendar's
    // loop and skipped every account after it, not just this one.
    return { imported: 0, deleted: 0, errors: [`Couldn't authorize: ${describeGoogleError(err)}`] };
  }
  if (!auth) return { imported: 0, deleted: 0, errors: [] };
  const calendar = google.calendar({ version: "v3", auth: auth.client });

  const timeMin = new Date(
    Date.now() - SYNC_PAST_DAYS * 86_400_000,
  ).toISOString();
  const timeMax = new Date(
    Date.now() + SYNC_FUTURE_DAYS * 86_400_000,
  ).toISOString();

  const res = await calendar.events.list({
    calendarId: auth.calendar.calendarId,
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
  const errors: string[] = [];
  for (const item of items) {
    try {
      if (!item.id) continue;
      if (item.status === "cancelled") {
        // Deleted directly on Google (not through this app) — remove the
        // local copy so it doesn't linger here after being gone on
        // Google. Scoped to (googleCalendarId, googleEventId) — unique
        // together, not globally — so this can never touch a
        // LOCAL-sourced event or a same-id event from a *different*
        // subscribed calendar.
        const { count } = await prisma.event.deleteMany({
          where: { googleCalendarId: auth.calendar.id, googleEventId: item.id },
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
        where: { googleCalendarId_googleEventId: { googleCalendarId: auth.calendar.id, googleEventId: item.id } },
        create: {
          userId: auth.account.userId,
          title: item.summary ?? "(untitled)",
          notes: item.description ?? null,
          location: item.location ?? null,
          start,
          end,
          allDay,
          recurrenceRule: extractRRule(item.recurrence),
          color: item.colorId ? GOOGLE_TO_LOCAL_COLOR[item.colorId] ?? null : null,
          source: "GOOGLE",
          googleCalendarId: auth.calendar.id,
          googleEventId: item.id,
          googleUpdatedAt: item.updated ? new Date(item.updated) : new Date(),
        },
        update: {
          title: item.summary ?? "(untitled)",
          notes: item.description ?? null,
          location: item.location ?? null,
          start,
          end,
          allDay,
          recurrenceRule: extractRRule(item.recurrence),
          color: item.colorId ? GOOGLE_TO_LOCAL_COLOR[item.colorId] ?? null : null,
          googleUpdatedAt: item.updated ? new Date(item.updated) : new Date(),
        },
      });
      imported++;
    } catch (err) {
      // One bad item shouldn't sink the rest of the batch.
      console.error(`importFromGoogle: skipping item ${item.id}:`, err);
      errors.push(`"${item.summary ?? item.id}": ${describeGoogleError(err)}`);
    }
  }

  await prisma.googleCalendar.update({
    where: { id: auth.calendar.id },
    data: { lastSyncedAt: new Date() },
  });

  return { imported, deleted, errors };
}

/**
 * Pushes local events that are new (no googleEventId yet) or have been
 * locally edited since the last push (localDirty) to the connected
 * Google calendar. Deliberately NOT based on updatedAt > googleUpdatedAt
 * — @updatedAt bumps on every write including this function's own
 * bookkeeping and importFromGoogle's upserts, which made every row look
 * permanently dirty regardless of any real local edit.
 */
export async function exportToGoogle(googleCalendarId: string) {
  let auth;
  try {
    auth = await getAuthorizedClientForCalendar(googleCalendarId);
  } catch (err) {
    return { exported: 0, errors: [`Couldn't authorize: ${describeGoogleError(err)}`] };
  }
  if (!auth || !auth.account.userId) return { exported: 0, errors: [] };
  const calendar = google.calendar({ version: "v3", auth: auth.client });

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: auth.account.userId },
    select: { timezone: true },
  });
  const timeZone = owner.timezone ?? LOCAL_TIMEZONE;
  // This calendar's own events (explicitly tagged), plus any of this
  // user's untagged events *if* this is their default calendar (default
  // account's default calendar) — an event only ever gets picked up by
  // one subscribed calendar at a time.
  const isGlobalDefault = auth.account.isDefault && auth.calendar.isDefault;
  const all = await prisma.event.findMany({
    where: {
      userId: auth.account.userId,
      OR: [
        { googleCalendarId: auth.calendar.id },
        ...(isGlobalDefault ? [{ googleCalendarId: null }] : []),
      ],
    },
  });
  const toPush = all.filter((e) => !e.googleEventId || e.localDirty);

  let exported = 0;
  const errors: string[] = [];
  for (const event of toPush) {
    try {
      const body = {
        summary: event.title,
        description: event.notes ?? undefined,
        location: event.location ?? undefined,
        start: event.allDay
          ? { date: formatYMD(event.start) }
          : { dateTime: event.start.toISOString(), timeZone },
        end: event.allDay
          ? { date: formatYMD(event.end) }
          : { dateTime: event.end.toISOString(), timeZone },
        recurrence: event.recurrenceRule ? [`RRULE:${event.recurrenceRule}`] : undefined,
        colorId: event.color ? LOCAL_TO_GOOGLE_COLOR[event.color] : undefined,
      };

      if (event.googleEventId) {
        const updated = await calendar.events.update({
          calendarId: auth.calendar.calendarId,
          eventId: event.googleEventId,
          requestBody: body,
        });
        // updateMany, not update: the scheduler can delete-and-recreate
        // this row (a reschedule, or toggleTaskDone truncating an early
        // finish) while the Google API call above was in flight. update()
        // would throw on the now-missing id and abandon this Google event
        // still holding local state (localDirty stays true, so it'd just
        // get pushed again next run) — a relatively harmless case, unlike
        // the insert branch below.
        await prisma.event.updateMany({
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
          calendarId: auth.calendar.calendarId,
          requestBody: body,
        });
        const result = await prisma.event.updateMany({
          where: { id: event.id },
          data: {
            localDirty: false,
            // Pin it to this calendar now — a later change to which
            // calendar is "default" shouldn't reroute an event that's
            // already been pushed somewhere.
            googleCalendarId: auth.calendar.id,
            googleEventId: created.data.id ?? undefined,
            googleUpdatedAt: created.data.updated
              ? new Date(created.data.updated)
              : new Date(),
          },
        });
        // The local row this Google event was meant to link to is gone
        // (deleted/rescheduled while the insert call above was in
        // flight) — nothing will ever claim created.data.id now, so
        // without this cleanup it sits on Google as an untracked event
        // that the next importFromGoogle pulls back in as an uncolored,
        // task-less duplicate. Delete it there too rather than leave it
        // orphaned.
        if (result.count === 0 && created.data.id) {
          await calendar.events
            .delete({ calendarId: auth.calendar.calendarId, eventId: created.data.id })
            .catch((err) => console.error(`exportToGoogle: cleanup of orphaned ${created.data.id} failed:`, err));
          continue;
        }
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
        errors.push(`"${event.title}": ${describeGoogleError(err)}`);
      }
    }
  }

  return { exported, errors };
}

/** Push local deletion of a Google-linked event before its row is removed. */
export async function deleteFromGoogle(googleCalendarId: string, googleEventId: string) {
  try {
    const auth = await getAuthorizedClientForCalendar(googleCalendarId);
    if (!auth) return;
    const calendar = google.calendar({ version: "v3", auth: auth.client });
    await calendar.events.delete({
      calendarId: auth.calendar.calendarId,
      eventId: googleEventId,
    });
  } catch (err) {
    // Already gone on Google's side, offline, or a dead/revoked refresh
    // token (getAuthorizedClientForCalendar throws in that case, same as
    // syncGoogleCalendar's own auth call) — local deletion should still
    // proceed either way, so this is deliberately swallowed. Previously
    // only the calendar.events.delete call was wrapped, so an expired
    // token threw straight out of deleteEvent and silently blocked the
    // local delete too.
    console.error("deleteFromGoogle failed:", err);
  }
}

/**
 * Deletes every Event matching `where` — pushing a Google-side deletion
 * first for any that are synced, exactly like the single-event
 * deleteEvent action already did. Without this, a raw
 * `prisma.event.deleteMany` (the scheduler rescheduling/unscheduling a
 * task, or deleting a task outright) orphans that event on Google's
 * side; it lingers there forever and the next importFromGoogle pulls it
 * back in as a duplicate local row, since its old local row (and thus
 * the (googleCalendarId, googleEventId) pairing it used to own) is gone.
 * Every scheduler call site that bulk-deletes Events now routes through
 * this instead of a bare deleteMany.
 */
export async function deleteEventsWithGoogleCleanup(where: Prisma.EventWhereInput) {
  const events = await prisma.event.findMany({
    where,
    select: { id: true, userId: true, googleEventId: true, googleCalendarId: true },
  });
  // Only ever delete the local row once the Google side is either cleaned
  // up or was never synced — an event whose Google cleanup couldn't be
  // attempted (no resolvable calendar) or failed stays put rather than
  // being silently orphaned on Google (where it would reappear as a
  // duplicate on the next import).
  const deletableIds: string[] = [];
  // Memoized per userId — a bulk delete/reschedule sweep can hit dozens of
  // events sharing the same owner, and this lookup resolves to the same
  // row every time for a given user.
  const defaultCalendarIdByUser = new Map<string | null, string | undefined>();
  for (const event of events) {
    if (!event.googleEventId) {
      deletableIds.push(event.id);
      continue;
    }
    let targetCalendarId = event.googleCalendarId ?? undefined;
    if (!targetCalendarId) {
      if (!defaultCalendarIdByUser.has(event.userId)) {
        const defaultCalendar = await prisma.googleCalendar.findFirst({
          where: { isDefault: true, googleAccount: { userId: event.userId, isDefault: true } },
        });
        defaultCalendarIdByUser.set(event.userId, defaultCalendar?.id);
      }
      targetCalendarId = defaultCalendarIdByUser.get(event.userId);
    }
    if (!targetCalendarId) {
      console.error(`deleteEventsWithGoogleCleanup: no target calendar for event ${event.id}, leaving it in place`);
      continue;
    }
    // deleteFromGoogle deliberately never throws (see its own comment) —
    // an unreachable API or an already-gone event still lets the local
    // delete proceed, same as the single-event delete path already does.
    await deleteFromGoogle(targetCalendarId, event.googleEventId);
    deletableIds.push(event.id);
  }
  if (deletableIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: deletableIds } } });
  }
}

/** Runs export+import against every Google calendar this user subscribes to. */
export async function syncGoogleCalendar(userId: string) {
  const calendars = await listGoogleCalendarSubscriptions(userId);
  let exported = 0;
  let imported = 0;
  let deleted = 0;
  const errors: string[] = [];
  for (const cal of calendars) {
    const exportResult = await exportToGoogle(cal.id);
    const importResult = await importFromGoogle(cal.id);
    exported += exportResult.exported;
    imported += importResult.imported;
    deleted += importResult.deleted;
    errors.push(...exportResult.errors, ...importResult.errors);
  }
  return { exported, imported, deleted, errors };
}
