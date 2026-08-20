import { prisma } from "@/lib/prisma";
import { parseIcsEvents } from "@/lib/ics";

// Windowed the same way Apple sync is — a holiday/public calendar can
// span decades of one-off entries; only its own recurring VEVENTs (kept
// regardless, expanded on the fly like any other recurring Event) are
// worth holding onto outside this window.
const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 90;
const MAX_ICS_BYTES = 5 * 1024 * 1024;

export type SubscriptionSyncResult =
  | { ok: true; imported: number }
  | { ok: false; error: string };

/**
 * Fetches one subscription's ICS URL and upserts its VEVENTs as locked,
 * read-only Event rows (source SUBSCRIBED) — same materialize-and-prune
 * shape as importFromApple, just over plain HTTP instead of CalDAV.
 */
export async function syncCalendarSubscription(
  subscriptionId: string,
  userId: string,
): Promise<SubscriptionSyncResult> {
  const subscription = await prisma.calendarSubscription.findFirst({
    where: { id: subscriptionId, userId },
  });
  if (!subscription) return { ok: false, error: "Subscription not found." };

  let text: string;
  try {
    const res = await fetch(subscription.url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ICS_BYTES) throw new Error("File too large");
    text = new TextDecoder().decode(buf);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Couldn't fetch that URL.";
    await prisma.calendarSubscription.update({
      where: { id: subscriptionId },
      data: { lastError: error, lastFetchedAt: new Date() },
    });
    return { ok: false, error };
  }

  let parsed;
  try {
    parsed = parseIcsEvents(text);
  } catch {
    const error = "Couldn't parse that URL's response as a calendar.";
    await prisma.calendarSubscription.update({
      where: { id: subscriptionId },
      data: { lastError: error, lastFetchedAt: new Date() },
    });
    return { ok: false, error };
  }

  const windowStart = new Date(Date.now() - SYNC_PAST_DAYS * 86_400_000);
  const windowEnd = new Date(Date.now() + SYNC_FUTURE_DAYS * 86_400_000);
  const inScope = parsed.filter(
    (e) => e.recurrenceRule || (e.end >= windowStart && e.start <= windowEnd),
  );

  const seenUids = new Set<string>();
  let imported = 0;
  for (const event of inScope) {
    seenUids.add(event.uid);
    await prisma.event.upsert({
      where: {
        subscriptionId_subscriptionEventUid: {
          subscriptionId,
          subscriptionEventUid: event.uid,
        },
      },
      create: {
        userId,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        notes: event.notes,
        recurrenceRule: event.recurrenceRule,
        source: "SUBSCRIBED",
        subscriptionId,
        subscriptionEventUid: event.uid,
        locked: true,
      },
      update: {
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        notes: event.notes,
        recurrenceRule: event.recurrenceRule,
      },
    });
    imported++;
  }

  await prisma.event.deleteMany({
    where: {
      subscriptionId,
      subscriptionEventUid: { notIn: [...seenUids] },
    },
  });

  await prisma.calendarSubscription.update({
    where: { id: subscriptionId },
    data: { lastError: null, lastFetchedAt: new Date() },
  });

  return { ok: true, imported };
}
