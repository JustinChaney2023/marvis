import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { listRecordings } from "@/lib/recordings";
import { transcribeConfigFromSettings } from "@/lib/settings";
import { getAppSettings } from "@/lib/settings";
import Link from "next/link";
import RecordingCapture from "./RecordingCapture";
import RecordingsList from "./RecordingsList";

/**
 * Recording home. `?eventId=` arrives from an event's "Record" link so a
 * lecture recording attaches to that class event — which is also what
 * gives the transcriber its context prompt (see buildTranscriptionPrompt).
 */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; projectId?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  // Scoped to this user, so a guessed id in the URL can't attach a
  // recording to someone else's event or project.
  const [event, project, settings] = await Promise.all([
    sp.eventId
      ? prisma.event.findFirst({
          where: { id: sp.eventId, userId: user.id },
          select: { id: true, title: true, taskId: true },
        })
      : null,
    sp.projectId
      ? prisma.project.findFirst({
          where: { id: sp.projectId, userId: user.id },
          select: { id: true, name: true },
        })
      : null,
    getAppSettings(user.id),
  ]);

  const recordings = await listRecordings(user.id, {});
  const configured = Boolean(transcribeConfigFromSettings(settings));
  const attachedTo = event?.title ?? project?.name ?? null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Recordings</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Record a lecture or meeting, or upload one — it&apos;s transcribed and turned into notes with
        action items you can turn into tasks.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          No transcription endpoint is set up yet — recordings will upload but can&apos;t be
          transcribed.{" "}
          <Link href="/settings" className="underline">
            Configure one in Settings → AI
          </Link>
          .
        </p>
      )}

      {attachedTo && (
        <p className="mt-4 text-sm text-zinc-500">
          Recording for <span className="font-medium text-zinc-800 dark:text-zinc-200">{attachedTo}</span>
        </p>
      )}

      <div className="mt-4">
        <RecordingCapture
          eventId={event?.id ?? null}
          projectId={project?.id ?? null}
          defaultTitle={attachedTo ?? undefined}
        />
      </div>

      <h2 className="mt-8 text-sm font-semibold text-zinc-500">All recordings</h2>
      <RecordingsList recordings={recordings} />
    </main>
  );
}
