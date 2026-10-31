import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isGithubFeedbackConfigured } from "@/lib/githubIssues";
import SendToClaudeButton from "./SendToClaudeButton";

const CATEGORY_BADGE: Record<string, string> = {
  BUG: "bg-accent-wash text-accent",
  SUGGESTION: "bg-rule-soft text-ink-2",
  OTHER: "bg-rule-soft text-ink-2",
};

export default async function FeedbackInboxPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();

  const feedback = await prisma.feedback.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, name: true } } },
    take: 200,
  });
  const githubOn = isGithubFeedbackConfigured();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl text-ink">Feedback inbox</h1>
        <Link
          href="/settings"
          className="text-sm text-ink-2 transition-colors hover:text-ink"
        >
          ← Settings
        </Link>
      </div>

      <ul className="mt-6 space-y-3">
        {feedback.map((f) => (
          <li
            key={f.id}
            className="rounded-xl border border-rule bg-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className={`rounded-full px-2 py-0.5 font-medium ${CATEGORY_BADGE[f.category]}`}>
                {f.category}
              </span>
              <span>{f.user?.name ?? f.user?.email ?? "unknown"}</span>
              {f.page && <span>· {f.page}</span>}
              <span>· {f.createdAt.toLocaleString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{f.message}</p>
            {(f.githubIssueUrl || githubOn) && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                {f.githubIssueUrl && (
                  <a href={f.githubIssueUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                    Issue #{f.githubIssueNumber}
                  </a>
                )}
                {f.sentToClaudeAt ? (
                  <span>Sent to Claude {f.sentToClaudeAt.toLocaleDateString()} — a PR will appear on the issue</span>
                ) : (
                  githubOn && <SendToClaudeButton feedbackId={f.id} />
                )}
              </div>
            )}
          </li>
        ))}
        {feedback.length === 0 && (
          <li className="rounded-xl border border-dashed border-rule py-8 text-center text-sm text-muted">
            No feedback yet.
          </li>
        )}
      </ul>
    </main>
  );
}
