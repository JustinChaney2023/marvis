import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableBookingSlots } from "@/lib/booking";
import BookingClient, { type BookingDay } from "./BookingClient";

export default async function PublicBookingPage(
  props: PageProps<"/book/[slug]">,
) {
  const { slug } = await props.params;

  // Direct lookup, not getAppSettings() — the single AppSettings row may
  // not even have a bookingSlug yet (fresh install, owner hasn't set it
  // up), and the only thing we actually need to check is "does this
  // exact slug match an enabled booking row?".
  const settings = await prisma.appSettings.findFirst({
    where: { bookingSlug: slug },
    select: {
      bookingEnabled: true,
      bookingTitle: true,
      bookingDurationMin: true,
      bookingSlug: true,
    },
  });
  if (!settings || !settings.bookingEnabled || !settings.bookingSlug) {
    notFound();
  }

  const raw = await getAvailableBookingSlots();
  const availability: BookingDay[] = raw.map((entry) => ({
    dayLabel: entry.day,
    slots: entry.slots.map((d) => d.toISOString()),
  }));

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-bold tracking-tight">
          {settings.bookingTitle}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick a time ({settings.bookingDurationMin} min)
        </p>

        <BookingClient
          title={settings.bookingTitle}
          durationMinutes={settings.bookingDurationMin}
          availability={availability}
        />
      </div>
    </main>
  );
}
