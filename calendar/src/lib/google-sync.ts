import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getAuthorizedClient, listGoogleAccounts } from "@/lib/google-auth";
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
export async function importFromGoogle(googleAccountId: string) {
  let auth;
  try {
    auth = await getAuthorizedClient(googleAccountId);
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
  const errors: string[] = [];
  for (const item of items) {
    try {
      if (!item.id) continue;
      if (item.status === "cancelled") {
        // Deleted directly on Google (not through this app) — remove the
        // local copy so it doesn't linger here after being gone on
        // Google. Scoped to (googleAccountId, googleEventId) — unique
        // together, not globally — so this can never touch a
        // LOCAL-sourced event or a same-id event from a *different*
        // connected account.
        const { count } = await prisma.event.deleteMany({
          where: { googleAccountId: auth.account.id, googleEventId: item.id },
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
        where: { googleAccountId_googleEventId: { googleAccountId: auth.account.id, googleEventId: item.id } },
        create: {
          userId: auth.account.userId,
          title: item.summary ?? "(untitled)",
          notes: item.description ?? null,
          location: item.location ?? null,
          start,
          end,
          allDay,
          recurrenceRule: extractRRule(item.recurrence),
          source: "GOOGLE",
          googleAccountId: auth.account.id,
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

  await prisma.googleAccount.update({
    where: { id: auth.account.id },
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
export async function exportToGoogle(googleAccountId: string) {
  let auth;
  try {
    auth = await getAuthorizedClient(googleAccountId);
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
  // This account's own events (explicitly tagged), plus any of this
  // user's untagged events *if* this is their default account — an
  // event only ever gets picked up by one connected account at a time.
  const all = await prisma.event.findMany({
    where: {
      userId: auth.account.userId,
      OR: [
        { googleAccountId: auth.account.id },
        ...(auth.account.isDefault ? [{ googleAccountId: null }] : []),
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
            // Pin it to this account now — a later change to which
            // account is "default" shouldn't reroute an event that's
            // already been pushed somewhere.
            googleAccountId: auth.account.id,
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
        errors.push(`"${event.title}": ${describeGoogleError(err)}`);
      }
    }
  }

  return { exported, errors };
}

/** Push local deletion of a Google-linked event before its row is removed. */
export async function deleteFromGoogle(googleAccountId: string, googleEventId: string) {
  const auth = await getAuthorizedClient(googleAccountId);
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

/** Runs export+import against every Google account this user has connected. */
export async function syncGoogleCalendar(userId: string) {
  const accounts = await listGoogleAccounts(userId);
  let exported = 0;
  let imported = 0;
  let deleted = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    const exportResult = await exportToGoogle(account.id);
    const importResult = await importFromGoogle(account.id);
    exported += exportResult.exported;
    imported += importResult.imported;
    deleted += importResult.deleted;
    errors.push(...exportResult.errors, ...importResult.errors);
  }
  return { exported, imported, deleted, errors };
}
