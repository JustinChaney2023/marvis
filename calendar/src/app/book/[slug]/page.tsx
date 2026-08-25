import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAvailableBookingSlots } from "@/lib/booking";
import BookingClient, { type BookingDay } from "./BookingClient";
import Card from "../../ui/Card";

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
    link.maxPerDay,
    link.id,
  );
  const availability: BookingDay[] = raw.map((entry) => ({
    dayLabel: entry.day,
    slots: entry.slots.map((d) => d.toISOString()),
  }));

  return (
    <main className="mx-auto w-full max-w-lg flex-1 bg-paper px-6 py-12">
      <Card padding="lg">
        <h1 className="font-serif text-3xl text-ink">
          {link.title}
        </h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Pick a time ({link.durationMin} min) — shown in your
          local time zone
        </p>

        <BookingClient
          slug={slug}
          title={link.title}
          durationMinutes={link.durationMin}
          availability={availability}
        />
      </Card>
    </main>
  );
}
