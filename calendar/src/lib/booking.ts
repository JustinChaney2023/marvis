import { prisma } from "@/lib/prisma";
import {
  fetchBusyIntervals,
  findEarliestSlot,
  padForBuffer,
} from "@/lib/scheduler";
import { getAppSettings } from "@/lib/settings";

const BOOKING_HORIZON_DAYS = 14;
const MAX_SLOTS_PER_DAY = 40; // safety cap, not a real-world limit at 15-min granularity

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

/**
 * Creates a booking as a locked Event (so it's immune to auto-
 * rescheduling), after re-checking the slot is still free — the
 * available-slots list a visitor loaded could be stale by the time they
 * submit (another booking, or the owner adding an event, in between).
 */
export async function createBooking(
  startIso: string,
  name: string,
  email: string,
  notes: string,
): Promise<CreateBookingResult> {
  const settings = await getAppSettings();
  if (!settings.bookingEnabled) {
    return { ok: false, error: "Booking is not currently enabled." };
  }

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return { ok: false, error: "That time is no longer valid." };
  }
  const end = new Date(start.getTime() + settings.bookingDurationMin * 60_000);

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000);
  const busy = padForBuffer(
    await fetchBusyIntervals(now, horizonEnd),
    settings.bufferMin,
  );
  const stillFree = !busy.some((b) => b.start < end && b.end > start);
  if (!stillFree) {
    return { ok: false, error: "That slot was just booked — please pick another." };
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, error: "Name is required." };
  }

  const noteLines = [`Booked by: ${trimmedName}`];
  if (email.trim()) noteLines.push(`Email: ${email.trim()}`);
  if (notes.trim()) noteLines.push("", notes.trim());

  await prisma.event.create({
    data: {
      title: `${trimmedName} — ${settings.bookingTitle}`,
      start,
      end,
      locked: true,
      notes: noteLines.join("\n"),
    },
  });

  return { ok: true };
}
