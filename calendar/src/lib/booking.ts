import { prisma } from "@/lib/prisma";
import {
  excludeDaysWindowFn,
  fetchBusyIntervals,
  findEarliestSlot,
  padForBuffer,
  windowFnForWorkingHours,
} from "@/lib/scheduler";
import { getAppSettings } from "@/lib/settings";
import { getZonedDateParts, zonedWallTimeToUtc } from "@/lib/timezone";

const BOOKING_HORIZON_DAYS = 14;
const MAX_SLOTS_PER_DAY = 40; // safety cap, not a real-world limit at 15-min granularity
const MAX_NAME_LEN = 100;
const MAX_EMAIL_LEN = 200;
const MAX_NOTES_LEN = 2000;

/**
 * All open slots over the next BOOKING_HORIZON_DAYS, grouped by day, for
 * the public booking page. Reuses the scheduler's own busy-interval /
 * work-hours / buffer logic so booking availability is exactly what the
 * auto-scheduler would also consider free — a visitor can never book over
 * something the scheduler would have placed a task into, or vice versa.
 */
export async function getAvailableBookingSlots(
  ownerUserId: string,
  durationMin: number,
  excludeDays: string | null = null,
  minNoticeMin: number = 60,
  maxPerDay: number | null = null,
  bookingLinkId: string | null = null,
): Promise<{ day: string; slots: Date[] }[]> {
  const [settings, owner] = await Promise.all([
    getAppSettings(ownerUserId),
    prisma.user.findUniqueOrThrow({ where: { id: ownerUserId }, select: { timezone: true } }),
  ]);
  const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const earliestBookable = new Date(now.getTime() + minNoticeMin * 60_000);
  const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000);

  const busy = padForBuffer(
    await fetchBusyIntervals(ownerUserId, now, horizonEnd),
    settings.bufferMin,
  );
  const getWindow = excludeDaysWindowFn(excludeDays, windowFnForWorkingHours(settings, timeZone), timeZone);

  // Already-booked counts for this link, per owner-timezone day — only
  // meaningful with a real link + cap; a `bookingLinkId`-less caller
  // (the generic "share my availability" text, which isn't tied to any
  // one link) never has a per-link limit to enforce.
  const alreadyBookedByDay = new Map<string, number>();
  if (maxPerDay != null && bookingLinkId) {
    const booked = await prisma.event.findMany({
      where: { bookingLinkId, start: { gte: now, lt: horizonEnd } },
      select: { start: true },
    });
    for (const b of booked) {
      const { year, month, day } = getZonedDateParts(b.start, timeZone);
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      alreadyBookedByDay.set(key, (alreadyBookedByDay.get(key) ?? 0) + 1);
    }
  }

  const byDay = new Map<string, Date[]>();
  let cursor = earliestBookable;
  for (let i = 0; i < BOOKING_HORIZON_DAYS * MAX_SLOTS_PER_DAY; i++) {
    const slot = findEarliestSlot(
      cursor,
      durationMin,
      busy,
      horizonEnd,
      getWindow,
      timeZone,
    );
    if (!slot) break;

    // Grouped by the *owner's* calendar day, not the server's — this is
    // their published availability, so "today"/"tomorrow" on the booking
    // page has to match their own wall-clock day. Zero-padded ISO
    // (matching calendar-dates.ts's formatYMD) since callers `new Date()`
    // this string back for display.
    const { year, month, day } = getZonedDateParts(slot.start, timeZone);
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const list = byDay.get(key) ?? [];
    const dayTotal = (alreadyBookedByDay.get(key) ?? 0) + list.length;
    if (list.length < MAX_SLOTS_PER_DAY && (maxPerDay == null || dayTotal < maxPerDay)) {
      list.push(slot.start);
      byDay.set(key, list);
    }
    cursor = new Date(slot.start.getTime() + durationMin * 60_000);
  }

  return Array.from(byDay.entries()).map(([day, slots]) => ({ day, slots }));
}

export type CreateBookingResult =
  | { ok: true }
  | { ok: false; error: string };

// Single Node process, no horizontal scaling for a personal app — a plain
// in-memory promise chain is enough to make "check availability, then
// create" actually atomic instead of two separate statements two
// concurrent requests could both pass. Doesn't survive a restart or scale
// across processes, which is fine at this scale; the alternative (a real
// DB-level exclusion constraint) is more machinery than this deployment
// warrants. Keyed per owner so two different people's booking pages don't
// serialize behind each other.
const bookingQueues = new Map<string, Promise<unknown>>();

/**
 * Creates a booking as a locked Event (so it's immune to auto-
 * rescheduling), after re-validating that `startIso` is an actual slot
 * getAvailableBookingSlots() would have generated — not just "doesn't
 * overlap something," which would let a visitor book outside work hours,
 * on a non-work day, or arbitrarily far past the horizon. Serialized per
 * owner via bookingQueues so two near-simultaneous submissions for the
 * same slot can't both pass the check before either write lands.
 */
export async function createBooking(
  ownerUserId: string,
  bookingLinkId: string,
  startIso: string,
  name: string,
  email: string,
  notes: string,
): Promise<CreateBookingResult> {
  const trimmedName = name.trim().slice(0, MAX_NAME_LEN);
  const trimmedEmail = email.trim().slice(0, MAX_EMAIL_LEN);
  const trimmedNotes = notes.trim().slice(0, MAX_NOTES_LEN);
  if (!trimmedName) {
    return { ok: false, error: "Name is required." };
  }

  const run = async (): Promise<CreateBookingResult> => {
    const link = await prisma.bookingLink.findUnique({ where: { id: bookingLinkId } });
    if (!link || link.userId !== ownerUserId || !link.enabled) {
      return { ok: false, error: "Booking is not currently enabled." };
    }
    const [settings, owner] = await Promise.all([
      getAppSettings(ownerUserId),
      prisma.user.findUniqueOrThrow({ where: { id: ownerUserId }, select: { timezone: true } }),
    ]);
    const timeZone = owner.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    const start = new Date(startIso);
    if (
      Number.isNaN(start.getTime()) ||
      start.getTime() < Date.now() + link.minNoticeMin * 60_000
    ) {
      return { ok: false, error: "That time is no longer valid." };
    }

    const now = new Date();
    const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000);
    if (start.getTime() >= horizonEnd.getTime()) {
      return { ok: false, error: "That time is too far out to book." };
    }

    const busy = padForBuffer(
      await fetchBusyIntervals(ownerUserId, now, horizonEnd),
      settings.bufferMin,
    );

    // Re-derive the earliest valid slot from `start` itself — if `start`
    // really is an open, work-hours, correctly-aligned slot, the earliest
    // one on/after itself IS itself. Any other requested time (3am, a
    // weekend, mid-way through an existing block) yields something later.
    const derived = findEarliestSlot(
      start,
      link.durationMin,
      busy,
      horizonEnd,
      excludeDaysWindowFn(link.excludeDays, windowFnForWorkingHours(settings, timeZone), timeZone),
      timeZone,
    );
    if (!derived || derived.start.getTime() !== start.getTime()) {
      return { ok: false, error: "That slot isn't available — please pick another." };
    }

    if (link.maxPerDay != null) {
      const { year, month, day } = getZonedDateParts(start, timeZone);
      const dayStart = zonedWallTimeToUtc(year, month, day, 0, 0, timeZone);
      const dayEnd = zonedWallTimeToUtc(year, month, day, 23, 59, timeZone);
      const bookedToday = await prisma.event.count({
        where: { bookingLinkId: link.id, start: { gte: dayStart, lte: dayEnd } },
      });
      if (bookedToday >= link.maxPerDay) {
        return { ok: false, error: "That day is fully booked — please pick another." };
      }
    }

    const noteLines = [`Booked by: ${trimmedName}`];
    if (trimmedEmail) noteLines.push(`Email: ${trimmedEmail}`);
    if (trimmedNotes) noteLines.push("", trimmedNotes);

    await prisma.event.create({
      data: {
        userId: ownerUserId,
        title: `${trimmedName} — ${link.title}`,
        start: derived.start,
        end: derived.end,
        locked: true,
        notes: noteLines.join("\n"),
        bookingLinkId: link.id,
      },
    });

    return { ok: true };
  };

  const queue = bookingQueues.get(ownerUserId) ?? Promise.resolve();
  const result = queue.then(run, run);
  bookingQueues.set(ownerUserId, result.catch(() => {}));
  return result;
}
