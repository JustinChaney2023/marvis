import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { parseIcsEvents } from "@/lib/ics";

// Windowed the same way Apple sync is — a holiday/public calendar can
// span decades of one-off entries; only its own recurring VEVENTs (kept
// regardless, expanded on the fly like any other recurring Event) are
// worth holding onto outside this window.
const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 90;
const MAX_ICS_BYTES = 5 * 1024 * 1024;

// Unlike the local-AI URL (which *should* be allowed to reach localhost/
// LAN — that's the whole point of a self-hosted Ollama), an ICS
// subscription has no legitimate reason to ever point at an internal
// address — the feature is "subscribe to a public calendar." Any
// signed-in account could otherwise use this as a server-side SSRF
// probe (cloud metadata, other homelab services, this app's own admin
// surfaces) by pointing a subscription URL inward and reading the
// fetched body back out of the imported event titles/notes. Checked
// against the *resolved* address, not the hostname string, and redirects
// are disabled so a public URL can't bounce the fetch inward after the
// check runs.
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.includes("::ffff:127.") ||
    lower.includes("::ffff:169.254.") ||
    lower.includes("::ffff:10.") ||
    lower.includes("::ffff:192.168.")
  );
}

async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  const hostname = parsed.hostname;
  if (hostname.toLowerCase() === "localhost") {
    throw new Error("Refusing to contact an internal address.");
  }
  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("Refusing to contact an internal address.");
  }
}

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
    await assertPublicUrl(subscription.url);
    const res = await fetch(subscription.url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error("Refusing to follow a redirect for a subscription URL.");
    }
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
        excludeDates: event.excludeDates,
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
        excludeDates: event.excludeDates,
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
