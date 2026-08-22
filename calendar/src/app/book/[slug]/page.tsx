import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableBookingSlots } from "@/lib/booking";
import BookingClient, { type BookingDay } from "./BookingClient";

export default async function PublicBookingPage(
  props: PageProps<"/book/[slug]">,
) {
  const { slug } = await props.params;

  const link = await prisma.bookingLink.findUnique({ where: { slug } });
  if (!link || !link.enabled) {
    notFound();
  }

  const raw = await getAvailableBookingSlots(
    link.userId,
    link.durationMin,
    link.excludeDays,
    link.minNoticeMin,
  );
  const availability: BookingDay[] = raw.map((entry) => ({
    dayLabel: entry.day,
    slots: entry.slots.map((d) => d.toISOString()),
  }));

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="text-2xl font-bold tracking-tight">
          {link.title}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick a time ({link.durationMin} min) — shown in your
          local time zone
        </p>

        <BookingClient
          slug={slug}
          title={link.title}
          durationMinutes={link.durationMin}
          availability={availability}
        />
      </div>
    </main>
  );
}
