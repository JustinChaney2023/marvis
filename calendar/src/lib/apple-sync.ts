import { createDAVClient } from "tsdav";
import ICAL from "ical.js";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/tokenCrypto";

const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 90;
const ICLOUD_SERVER_URL = "https://caldav.icloud.com";

export type AppleSyncResult =
  | { ok: true; imported: number; deleted: number }
  | { ok: false; error: string };

/**
 * Pulls events from every calendar on the connected iCloud account into
 * local Event rows tagged source: APPLE, upserted by appleEventUid (the
 * iCalendar UID). Read-only overlay, not a two-way sync like Google —
 * rows are locked (can't be dragged/rescheduled) and nothing is ever
 * written back to iCloud. Windowed (past 7 / future 90 days), same as
 * Google's importFromGoogle.
 */
export async function importFromApple(userId: string): Promise<AppleSyncResult> {
  const account = await prisma.appleAccount.findUnique({ where: { userId } });
  if (!account) return { ok: false, error: "No Apple account connected." };

  let client;
  try {
    client = await createDAVClient({
      serverUrl: ICLOUD_SERVER_URL,
      credentials: {
        username: account.appleId,
        password: decryptSecret(account.appPassword),
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  } catch {
    return { ok: false, error: "Couldn't connect — check your Apple ID and app-specific password." };
  }

  const calendars = await client.fetchCalendars();
  if (calendars.length === 0) {
    return { ok: false, error: "Connected, but no calendars were found on this account." };
  }

  const timeMin = new Date(Date.now() - SYNC_PAST_DAYS * 86_400_000);
  const timeMax = new Date(Date.now() + SYNC_FUTURE_DAYS * 86_400_000);
  const seenUids = new Set<string>();
  let imported = 0;

  for (const calendar of calendars) {
    let objects;
    try {
      objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() },
      });
    } catch (err) {
      console.error(`importFromApple: skipping calendar ${calendar.url}:`, err);
      continue;
    }

    for (const obj of objects) {
      if (!obj.data) continue;
      try {
        const jcal = ICAL.parse(obj.data);
        const comp = new ICAL.Component(jcal);
        for (const vevent of comp.getAllSubcomponents("vevent")) {
          const event = new ICAL.Event(vevent);
          if (!event.uid || !event.startDate || !event.endDate) continue;

          seenUids.add(event.uid);
          const rruleProp = vevent.getFirstPropertyValue("rrule") as
            | { toString(): string }
            | null;

          await prisma.event.upsert({
            where: { appleEventUid: event.uid },
            create: {
              userId,
              title: event.summary || "(untitled)",
              start: event.startDate.toJSDate(),
              end: event.endDate.toJSDate(),
              allDay: event.startDate.isDate,
              recurrenceRule: rruleProp ? rruleProp.toString() : null,
              source: "APPLE",
              appleEventUid: event.uid,
              locked: true,
            },
            update: {
              title: event.summary || "(untitled)",
              start: event.startDate.toJSDate(),
              end: event.endDate.toJSDate(),
              allDay: event.startDate.isDate,
              recurrenceRule: rruleProp ? rruleProp.toString() : null,
            },
          });
          imported++;
        }
      } catch (err) {
        console.error(`importFromApple: skipping object ${obj.url}:`, err);
      }
    }
  }

  // Only prune rows that vanished from iCloud once every calendar was
  // successfully read — a partial failure above (one calendar's fetch
  // throwing) would otherwise look identical to "everything else was
  // deleted" and wipe rows that are still real.
  const deleted =
    seenUids.size > 0
      ? (
          await prisma.event.deleteMany({
            where: {
              userId,
              source: "APPLE",
              appleEventUid: { not: null, notIn: [...seenUids] },
            },
          })
        ).count
      : 0;

  await prisma.appleAccount.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return { ok: true, imported, deleted };
}
