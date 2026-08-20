"use client";

import { useState } from "react";
import { respondToInviteAction } from "../../actions";
import Button from "../../ui/Button";

type Status = "PENDING" | "ACCEPTED" | "DECLINED";

export default function RsvpClient({ token, initialStatus }: { token: string; initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [isSubmitting, setIsSubmitting] = useState<Status | null>(null);

  const respond = async (next: "ACCEPTED" | "DECLINED") => {
    setIsSubmitting(next);
    try {
      const ok = await respondToInviteAction(token, next);
      if (ok) setStatus(next);
    } finally {
      setIsSubmitting(null);
    }
  };

  if (status !== "PENDING") {
    return (
      <p className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-700/40">
        You&apos;ve {status === "ACCEPTED" ? "accepted" : "declined"} this invite.
        <button
          type="button"
          onClick={() => setStatus("PENDING")}
          className="ml-2 text-indigo-600 underline dark:text-indigo-400"
        >
          Change response
        </button>
      </p>
    );
  }

  return (
    <div className="mt-4 flex gap-2">
      <Button type="button" pending={isSubmitting === "ACCEPTED"} onClick={() => respond("ACCEPTED")}>
        Accept
      </Button>
      <Button
        type="button"
        variant="outline"
        pending={isSubmitting === "DECLINED"}
        onClick={() => respond("DECLINED")}
      >
        Decline
      </Button>
    </div>
  );
}
