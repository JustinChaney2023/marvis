import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import MeetClient from "./MeetClient";

// Group scheduling v1 — only works with people who've shared their
// calendar with you (CalendarShare, Settings → Calendars), since that's
// the only way this app has real busy-time to intersect against. Not
// "invite anyone by email" — see the group-scheduling GitHub issue for
// why that's a bigger, separate feature.
export default async function MeetPage() {
  const user = await requireUser();
  const shares = await prisma.calendarShare.findMany({
    where: { sharedWithId: user.id },
    include: { owner: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Find a group time</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Pick people who&apos;ve shared their calendar with you, and this
        finds the earliest slot that&apos;s open for everyone.
      </p>

      {shares.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nobody&apos;s shared their calendar with you yet. Ask a friend to
          add you in{" "}
          <Link href="/settings" className="text-indigo-600 dark:text-indigo-400">
            Settings → Calendars → Calendar sharing
          </Link>
          .
        </p>
      ) : (
        <MeetClient
          people={shares.map((s) => ({
            id: s.owner.id,
            name: s.owner.name,
            email: s.owner.email,
          }))}
        />
      )}
    </main>
  );
}
