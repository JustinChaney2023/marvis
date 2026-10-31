"use client";

import { useState, useTransition } from "react";
import { sendFeedbackToClaudeAction } from "../actions";
import Button from "../ui/Button";

/** Approves a piece of feedback for Claude to build (labels its GitHub issue). */
export default function SendToClaudeButton({ feedbackId }: { feedbackId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        pending={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await sendFeedbackToClaudeAction(feedbackId);
            setError(result.ok ? null : (result.error ?? "Failed."));
          })
        }
      >
        Build with Claude
      </Button>
      {error && <span className="text-xs text-accent">{error}</span>}
    </div>
  );
}
