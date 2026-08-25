"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  askRecordingQuestionAction,
  createTasksFromRecordingAction,
  deleteRecordingAction,
  getRecordingAction,
  retryRecordingAction,
} from "../actions";
import { formatDuration } from "@/lib/recordingFormat";
import { renderMarkdown } from "@/lib/markdown";
import type { RecordingActionItem } from "@/lib/recordings";
import Button from "../ui/Button";

type Row = {
  id: string;
  title: string;
  status: string;
  errorMessage: string | null;
  durationSec: number | null;
  createdAt: Date;
};

type Detail = Awaited<ReturnType<typeof getRecordingAction>>;
type ReviewItem = RecordingActionItem & { include: boolean };

const inputClass =
  "w-full rounded-lg border border-rule bg-surface px-2 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none";

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "Queued",
  TRANSCRIBING: "Transcribing…",
  SUMMARIZING: "Writing notes…",
  DONE: "Ready",
  FAILED: "Failed",
};

const IN_FLIGHT = ["UPLOADED", "TRANSCRIBING", "SUMMARIZING"];

// Transcription takes minutes, so the page has to move on its own —
// router.refresh() re-runs the server component that already knows how to
// list these, rather than duplicating that query in a client-side poll.
const POLL_MS = 5000;

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "FAILED"
      ? "border border-accent bg-accent-wash text-accent"
      : status === "DONE"
        ? "border border-rule bg-surface text-ink-2"
        : "border border-rule-soft bg-rule-soft text-muted";
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default function RecordingsList({ recordings }: { recordings: Row[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [created, setCreated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [askText, setAskText] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const anyInFlight = recordings.some((r) => IN_FLIGHT.includes(r.status));

  useEffect(() => {
    if (!anyInFlight) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [anyInFlight, router]);

  // Reload the open panel when its row finishes, so notes appear without
  // the user collapsing and reopening it.
  const openStatus = recordings.find((r) => r.id === openId)?.status;
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    void getRecordingAction(openId).then((d) => {
      if (cancelled) return;
      setDetail(d);
      setItems((d?.actionItems ?? []).map((i) => ({ ...i, include: true })));
    });
    return () => {
      cancelled = true;
    };
  }, [openId, openStatus]);

  const toggle = (id: string) => {
    setCreated(null);
    setShowTranscript(false);
    setAskText("");
    setAskError(null);
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      setItems([]);
      return;
    }
    setDetail(null);
    setOpenId(id);
  };

  const handleRetry = async (id: string) => {
    setBusy(true);
    try {
      await retryRecordingAction(id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteRecordingAction(id);
      if (openId === id) setOpenId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleAsk = async () => {
    if (!detail || !askText.trim()) return;
    setAsking(true);
    setAskError(null);
    try {
      const result = await askRecordingQuestionAction(detail.id, askText.trim());
      if (!result.ok) {
        setAskError(result.error);
        return;
      }
      setAskText("");
      // Refetch rather than append locally — the server-side questions
      // array is the source of truth (it's what gets persisted), and this
      // keeps the UI honest if two tabs ask questions concurrently.
      const refreshed = await getRecordingAction(detail.id);
      setDetail(refreshed);
    } finally {
      setAsking(false);
    }
  };

  const handleCreateTasks = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const chosen = items.filter((i) => i.include).map(({ title, dueDate }) => ({ title, dueDate }));
      const result = await createTasksFromRecordingAction(detail.id, chosen);
      setCreated(result.created);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (recordings.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-rule px-4 py-6 text-center text-sm text-muted">
        No recordings yet.
      </p>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {recordings.map((r) => (
        <li
          key={r.id}
          className="rounded-xl border border-rule bg-surface"
        >
          <div className="flex flex-wrap items-center gap-2 p-3">
            <button
              type="button"
              onClick={() => toggle(r.id)}
              aria-expanded={openId === r.id}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate font-medium text-ink">{r.title}</span>
              <span className="font-mono text-xs text-muted">
                {new Date(r.createdAt).toLocaleDateString()}
                {r.durationSec ? ` · ${formatDuration(r.durationSec)}` : ""}
              </span>
            </button>
            <StatusBadge status={r.status} />
            {r.status === "FAILED" && (
              <Button type="button" variant="outline" onClick={() => handleRetry(r.id)} disabled={busy}>
                Retry
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => handleDelete(r.id)} disabled={busy}>
              Delete
            </Button>
          </div>

          {r.errorMessage && (
            <p className="px-3 pb-3 text-sm text-accent">{r.errorMessage}</p>
          )}

          {openId === r.id && (
            <div className="border-t border-rule p-3">
              {!detail ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <audio controls src={`/uploads/${detail.audioPath}`} className="w-full" />

                  {detail.summary ? (
                    <div
                      className="prose prose-sm max-w-none text-ink [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.summary) }}
                    />
                  ) : (
                    <p className="text-sm text-muted">
                      Notes appear here once transcription and summarizing finish.
                    </p>
                  )}

                  {items.length > 0 && (
                    <div className="rounded-lg border border-rule p-3">
                      <h3 className="text-sm font-semibold text-ink">Action items</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        Review these before they become tasks — edit anything the transcript got wrong.
                      </p>
                      <ul className="mt-2 flex flex-col gap-2">
                        {items.map((item, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.include}
                              aria-label={`Include "${item.title}"`}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((p, j) => (j === i ? { ...p, include: e.target.checked } : p)),
                                )
                              }
                            />
                            <input
                              value={item.title}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((p, j) => (j === i ? { ...p, title: e.target.value } : p)),
                                )
                              }
                              className={`${inputClass} min-w-0 flex-1`}
                            />
                            <input
                              type="date"
                              value={item.dueDate ?? ""}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((p, j) =>
                                    j === i ? { ...p, dueDate: e.target.value || null } : p,
                                  ),
                                )
                              }
                              className={`${inputClass} w-auto`}
                            />
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={handleCreateTasks}
                          disabled={busy || !items.some((i) => i.include)}
                        >
                          Create tasks
                        </Button>
                        {created !== null && (
                          <span className="text-sm text-ink-2">
                            Created {created} task{created === 1 ? "" : "s"} — they&apos;ll be
                            auto-scheduled.
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {detail.transcript && (
                    <div className="rounded-lg border border-rule p-3">
                      <h3 className="text-sm font-semibold text-ink">Questions</h3>
                      {detail.questions.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-2">
                          {detail.questions.map((q, i) => (
                            <li key={i} className="text-sm">
                              <p className="text-muted">
                                {q.postHoc ? null : `[${formatDuration(q.atSec)}] `}
                                {q.text}
                              </p>
                              <p className="mt-0.5 text-ink">
                                {q.answer ?? <span className="text-muted italic">Answer pending…</span>}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          value={askText}
                          onChange={(e) => setAskText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleAsk();
                            }
                          }}
                          placeholder="Ask something about this recording…"
                          disabled={asking}
                          className={`${inputClass} min-w-0 flex-1`}
                        />
                        <Button type="button" variant="outline" onClick={handleAsk} disabled={asking || !askText.trim()}>
                          {asking ? "Asking…" : "Ask"}
                        </Button>
                      </div>
                      {askError && <p className="mt-1 text-xs text-accent">{askError}</p>}
                    </div>
                  )}

                  {detail.transcript && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowTranscript((s) => !s)}
                        className="text-sm text-accent hover:underline"
                      >
                        {showTranscript ? "Hide" : "Show"} transcript
                      </button>
                      {showTranscript && (
                        <p className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-rule-soft bg-paper p-3 text-sm whitespace-pre-wrap text-ink-2">
                          {detail.transcript}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
