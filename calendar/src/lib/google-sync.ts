import { google, type calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getAuthorizedClientForCalendar, listGoogleCalendarSubscriptions } from "@/lib/google-auth";
import { parseYMD, formatYMD } from "@/lib/calendar-dates";
import { zonedWallTimeToUtc } from "@/lib/timezone";

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
function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status ?? (err as { code?: number })?.code;
}

/**
 * Google EXDATE lines -> our excludeDates (comma-joined ISO starts).
 * Handles "EXDATE:20261105T150000Z", "EXDATE;TZID=Zone:20261105T100000"
 * and all-day "EXDATE;VALUE=DATE:20261105" (local midnight, like parseYMD).
 */
export function exdatesFromRecurrence(recurrence: string[] | null | undefined, fallbackZone: string): string[] {
  const out: string[] = [];
  for (const line of recurrence ?? []) {
    if (!line.startsWith("EXDATE")) continue;
    const [head, values] = line.split(":", 2);
    const tzid = head.match(/TZID=([^;]+)/)?.[1] ?? fallbackZone;
    for (const v of (values ?? "").split(",")) {
      const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
      if (!m) continue;
      const [, y, mo, d, h, mi, , z] = m;
      const date =
        h === undefined
          ? parseYMD(`${y}-${mo}-${d}`)
          : z
            ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
            : zonedWallTimeToUtc(+y, +mo, +d, +h, +mi, tzid);
      out.push(date.toISOString());
    }
  }
  return out;
}

function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Our recurrence fields -> Google's recurrence lines (RRULE + UNTIL + EXDATE). */
export function recurrenceForGoogle(event: {
  recurrenceRule: string | null;
  recurrenceEndsBefore: Date | null;
  excludeDates: string | null;
  allDay: boolean;
}): string[] | undefined {
  if (!event.recurrenceRule) return undefined;
  let rule = event.recurrenceRule;
  // A "this and following" split ends the series locally with
  // recurrenceEndsBefore — Google needs it as UNTIL, or the old series
  // keeps running there next to the new one.
  if (event.recurrenceEndsBefore && !/UNTIL=|COUNT=/.test(rule)) {
    const until = new Date(event.recurrenceEndsBefore.getTime() - 1000);
    rule += `;UNTIL=${event.allDay ? toIcsUtc(until).slice(0, 8) : toIcsUtc(until)}`;
  }
  const lines = [`RRULE:${rule}`];
  const excluded = (event.excludeDates ?? "").split(",").filter(Boolean);
  if (excluded.length > 0) {
    lines.push(
      event.allDay
        ? `EXDATE;VALUE=DATE:${excluded.map((iso) => formatYMD(new Date(iso)).replace(/-/g, "")).join(",")}`
        : `EXDATE:${excluded.map((iso) => toIcsUtc(new Date(iso))).join(",")}`,
    );
  }
  return lines;
}

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

  // Paginated — a single page caps at 250 items (and showDeleted makes
  // cancelled items count toward that), so busy calendars used to be
  // silently truncated.
  const items: calendar_v3.Schema$Event[] = [];
  try {
    let pageToken: string | undefined;
    do {
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
        pageToken,
      });
      items.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    return { imported: 0, deleted: 0, errors: [`Couldn't read ${auth.account.email}: ${describeGoogleError(err)}`] };
  }

  // Deleted here but not yet on Google (the next export removes them) —
  // don't import them right back.
  const pendingDeletes = new Set(
    (await prisma.googleDeletion.findMany({ where: { googleCalendarId: auth.calendar.id }, select: { googleEventId: true } })).map(
      (d) => d.googleEventId,
    ),
  );
  const owner = auth.account.userId
    ? await prisma.user.findUnique({ where: { id: auth.account.userId }, select: { timezone: true } })
    : null;
  const zone = owner?.timezone ?? LOCAL_TIMEZONE;

  // Series before their individual instances, so a cancelled instance
  // finds its master on the very first sync.
  items.sort((a, b) => Number(Boolean(a.recurringEventId)) - Number(Boolean(b.recurringEventId)));

  let imported = 0;
  let deleted = 0;
  const errors: string[] = [];
  for (const item of items) {
    try {
      if (!item.id || pendingDeletes.has(item.id)) continue;
      // A cancelled single occurrence of a recurring series: exclude that
      // occurrence from the series here instead of showing it.
      if (item.status === "cancelled" && item.recurringEventId) {
        const original = item.originalStartTime?.dateTime ?? item.originalStartTime?.date;
        const master = original
          ? await prisma.event.findFirst({
              where: { googleCalendarId: auth.calendar.id, googleEventId: item.recurringEventId },
              select: { id: true, excludeDates: true },
            })
          : null;
        if (master && original) {
          const iso = (item.originalStartTime?.dateTime ? new Date(original) : parseYMD(original)).toISOString();
          const current = (master.excludeDates ?? "").split(",").filter(Boolean);
          if (!current.includes(iso)) {
            await prisma.event.update({ where: { id: master.id }, data: { excludeDates: [...current, iso].join(",") } });
          }
        }
        continue;
      }
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
        // Already gone on Google — no need for the delete tracker's job.
        await prisma.googleDeletion.deleteMany({ where: { googleCalendarId: auth.calendar.id, googleEventId: item.id } });
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
      const exdates = exdatesFromRecurrence(item.recurrence, item.start.timeZone ?? zone);
      // Don't clobber a local edit that hasn't been pushed yet — export
      // runs first each sync, so this only skips rows whose push failed.
      const existingRow = await prisma.event.findUnique({
        where: { googleCalendarId_googleEventId: { googleCalendarId: auth.calendar.id, googleEventId: item.id } },
        select: { localDirty: true, excludeDates: true },
      });
      if (existingRow?.localDirty) continue;
      // Keep exclusions Season already knew (cancelled instances above) and add Google's EXDATEs.
      const mergedExcludes = [...new Set([...(existingRow?.excludeDates ?? "").split(","), ...exdates].filter(Boolean))];

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
          excludeDates: mergedExcludes.join(",") || null,
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
          excludeDates: mergedExcludes.join(",") || null,
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
  // Pending deletions first (task blocks rescheduled away, deleted tasks…):
  // events removed locally whose copy still lives on this calendar.
  const errors: string[] = [];
  const deletions = await prisma.googleDeletion.findMany({ where: { googleCalendarId: auth.calendar.id } });
  for (const d of deletions) {
    try {
      await calendar.events.delete({ calendarId: auth.calendar.calendarId, eventId: d.googleEventId });
    } catch (err) {
      const status = statusOf(err);
      if (status !== 404 && status !== 410) {
        errors.push(`Couldn't delete an event on Google: ${describeGoogleError(err)}`);
        continue;
      }
    }
    await prisma.googleDeletion.delete({ where: { id: d.id } });
  }

  // This calendar's own events (explicitly tagged), plus any of this
  // user's untagged events *if* this is their default calendar (default
  // account's default calendar) — an event only ever gets picked up by
  // one subscribed calendar at a time.
  const isGlobalDefault = auth.account.isDefault && auth.calendar.isDefault;
  const all = await prisma.event.findMany({
    where: {
      userId: auth.account.userId,
      // Only Season's own events and Google's own copies — never Apple or
      // subscribed-feed rows (those used to get pushed into Google).
      source: { in: ["LOCAL", "GOOGLE"] },
      OR: [
        { googleCalendarId: auth.calendar.id },
        ...(isGlobalDefault ? [{ googleCalendarId: null }] : []),
      ],
    },
  });
  const toPush = all.filter((e) => !e.googleEventId || e.localDirty);

  let exported = 0;
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
        recurrence: recurrenceForGoogle(event),
        colorId: event.color ? LOCAL_TO_GOOGLE_COLOR[event.color] : undefined,
      };

      if (event.googleEventId) {
        // patch, not update: update replaces the whole Google event,
        // wiping attendees, the Meet link, reminders, and colors Season
        // doesn't model.
        const updated = await calendar.events.patch({
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
            googleCalendarId: auth.calendar.id,
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
      const status = statusOf(err);
      if ((status === 404 || status === 410) && event.googleCalendarId === auth.calendar.id) {
        // Deleted on Google's side (in the calendar it was pushed to) —
        // without this the same event fails on every future sync.
        await prisma.event.deleteMany({ where: { id: event.id } });
        await prisma.googleDeletion.deleteMany({ where: { googleCalendarId: auth.calendar.id, googleEventId: event.googleEventId ?? "" } });
        console.error(`exportToGoogle: ${event.id} gone on Google, deleted locally`);
      } else if (status === 404 || status === 410) {
        // Linked to some other account/calendar that doesn't know it —
        // unlink and let it export fresh rather than deleting your event.
        await prisma.event.update({
          where: { id: event.id },
          data: { googleEventId: null, googleCalendarId: null, googleUpdatedAt: null, localDirty: true },
        });
      } else if (status === 403 && event.source === "GOOGLE") {
        // Someone else's invite you can't edit on Google — keep the local
        // edit local instead of retrying (and failing) every sync.
        await prisma.event.update({ where: { id: event.id }, data: { localDirty: false } });
        errors.push(`"${event.title}" can't be changed on Google (you're not the organizer).`);
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

// One sync per user at a time: two overlapping runs (two tabs, or the Sync
// button plus auto-sync) both inserted the same new events, duplicating
// them on Google and then back here. Single server process, so a map works.
const inFlight = new Map<string, ReturnType<typeof runSync>>();

/** Runs export+import against every Google calendar this user subscribes to. */
export function syncGoogleCalendar(userId: string) {
  const running = inFlight.get(userId);
  if (running) return running;
  const run = runSync(userId).finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

async function runSync(userId: string) {
  const calendars = await listGoogleCalendarSubscriptions(userId);
  let exported = 0;
  let imported = 0;
  let deleted = 0;
  const errors: string[] = [];
  for (const cal of calendars) {
    // One calendar failing (network, revoked access) mustn't stop the rest.
    const exportResult = await exportToGoogle(cal.id).catch((err) => ({ exported: 0, errors: [describeGoogleError(err)] }));
    const importResult = await importFromGoogle(cal.id).catch((err) => ({
      imported: 0,
      deleted: 0,
      errors: [describeGoogleError(err)],
    }));
    exported += exportResult.exported;
    imported += importResult.imported;
    deleted += importResult.deleted;
    errors.push(...exportResult.errors, ...importResult.errors);
  }
  return { exported, imported, deleted, errors };
}
