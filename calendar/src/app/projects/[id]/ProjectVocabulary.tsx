"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProjectVocabularyAction } from "../../actions";
import Button from "../../ui/Button";

type Props = {
  projectId: string;
  initialVocabulary: string;
  /** Exactly what gets sent to the transcriber, built server-side by formatTranscriptionPrompt. */
  promptPreview: string | null;
};

/**
 * The transcription hint, made visible and editable. The vocabulary the
 * syllabus provided is applied automatically, but only the person in the
 * room knows the lab equipment or the guest lecturer's name — and a
 * hidden prompt that silently shapes every transcript is worse than one
 * you can read.
 */
export default function ProjectVocabulary({ projectId, initialVocabulary, promptPreview }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialVocabulary);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateProjectVocabularyAction(projectId, value);
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        rows={2}
        placeholder="Names, equipment, or terms the transcriber keeps getting wrong"
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save vocabulary"}
        </Button>
        {saved && <span className="text-xs text-green-700 dark:text-green-400">Saved.</span>}
      </div>

      {promptPreview && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer">What the transcriber is told</summary>
          <p className="mt-1 rounded-lg bg-zinc-50 p-2 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {promptPreview}
          </p>
          <p className="mt-1">
            Sent with each recording for this project to bias it toward these words. A recording
            attached to a specific event also picks up that day&apos;s topic.
          </p>
        </details>
      )}
    </div>
  );
}
