import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

const CATEGORY_BADGE: Record<string, string> = {
  BUG: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  SUGGESTION: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  OTHER: "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
};

export default async function FeedbackInboxPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();

  const feedback = await prisma.feedback.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, name: true } } },
    take: 200,
  });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Feedback inbox</h1>
        <Link
          href="/settings"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Settings
        </Link>
      </div>

      <ul className="mt-6 space-y-3">
        {feedback.map((f) => (
          <li
            key={f.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className={`rounded-full px-2 py-0.5 font-medium ${CATEGORY_BADGE[f.category]}`}>
                {f.category}
              </span>
              <span>{f.user?.name ?? f.user?.email ?? "unknown"}</span>
              {f.page && <span>· {f.page}</span>}
              <span>· {f.createdAt.toLocaleString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{f.message}</p>
          </li>
        ))}
        {feedback.length === 0 && (
          <li className="rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No feedback yet.
          </li>
        )}
      </ul>
    </main>
  );
}
