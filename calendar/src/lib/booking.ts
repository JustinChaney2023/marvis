import { prisma } from "@/lib/prisma";
import {
  fetchBusyIntervals,
  findEarliestSlot,
  padForBuffer,
} from "@/lib/scheduler";
import { getAppSettings } from "@/lib/settings";

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
export async function getAvailableBookingSlots(): Promise<
  { day: string; slots: Date[] }[]
> {
  const settings = await getAppSettings();
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000);

  const busy = padForBuffer(
    await fetchBusyIntervals(now, horizonEnd),
    settings.bufferMin,
  );

  const byDay = new Map<string, Date[]>();
  let cursor = now;
  for (let i = 0; i < BOOKING_HORIZON_DAYS * MAX_SLOTS_PER_DAY; i++) {
    const slot = findEarliestSlot(
      cursor,
      settings.bookingDurationMin,
      busy,
      horizonEnd,
    );
    if (!slot) break;

    const key = slot.start.toDateString();
    const list = byDay.get(key) ?? [];
    if (list.length < MAX_SLOTS_PER_DAY) {
      list.push(slot.start);
      byDay.set(key, list);
    }
    cursor = new Date(slot.start.getTime() + settings.bookingDurationMin * 60_000);
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
// warrants.
let bookingQueue: Promise<unknown> = Promise.resolve();

/**
 * Creates a booking as a locked Event (so it's immune to auto-
 * rescheduling), after re-validating that `startIso` is an actual slot
 * getAvailableBookingSlots() would have generated — not just "doesn't
 * overlap something," which would let a visitor book outside work hours,
 * on a non-work day, or arbitrarily far past the horizon. Serialized via
 * bookingQueue so two near-simultaneous submissions for the same slot
 * can't both pass the check before either write lands.
 */
export async function createBooking(
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
    const settings = await getAppSettings();
    if (!settings.bookingEnabled) {
      return { ok: false, error: "Booking is not currently enabled." };
    }

    const start = new Date(startIso);
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
      return { ok: false, error: "That time is no longer valid." };
    }

    const now = new Date();
    const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000);
    if (start.getTime() >= horizonEnd.getTime()) {
      return { ok: false, error: "That time is too far out to book." };
    }

    const busy = padForBuffer(
      await fetchBusyIntervals(now, horizonEnd),
      settings.bufferMin,
    );

    // Re-derive the earliest valid slot from `start` itself — if `start`
    // really is an open, work-hours, correctly-aligned slot, the earliest
    // one on/after itself IS itself. Any other requested time (3am, a
    // weekend, mid-way through an existing block) yields something later.
    const derived = findEarliestSlot(
      start,
      settings.bookingDurationMin,
      busy,
      horizonEnd,
    );
    if (!derived || derived.start.getTime() !== start.getTime()) {
      return { ok: false, error: "That slot isn't available — please pick another." };
    }

    const noteLines = [`Booked by: ${trimmedName}`];
    if (trimmedEmail) noteLines.push(`Email: ${trimmedEmail}`);
    if (trimmedNotes) noteLines.push("", trimmedNotes);

    await prisma.event.create({
      data: {
        title: `${trimmedName} — ${settings.bookingTitle}`,
        start: derived.start,
        end: derived.end,
        locked: true,
        notes: noteLines.join("\n"),
      },
    });

    return { ok: true };
  };

  const result = bookingQueue.then(run, run);
  bookingQueue = result.catch(() => {});
  return result;
}
