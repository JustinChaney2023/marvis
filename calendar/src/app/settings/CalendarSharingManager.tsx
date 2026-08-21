"use client";

import { useState } from "react";
import {
  createCalendarShareAction,
  deleteCalendarShareAction,
  setCalendarShareHiddenAction,
} from "../actions";
import Button from "../ui/Button";

export type OwnedShare = {
  id: string;
  sharedWithEmail: string;
  sharedWithName: string | null;
  permission: "BUSY_ONLY" | "FULL_DETAILS";
};

export type ReceivedShare = {
  id: string;
  ownerEmail: string;
  ownerName: string | null;
  permission: "BUSY_ONLY" | "FULL_DETAILS";
  hidden: boolean;
};

const PERMISSION_LABEL: Record<OwnedShare["permission"], string> = {
  BUSY_ONLY: "Busy times only",
  FULL_DETAILS: "Full details",
};

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function CalendarSharingManager({
  given,
  received,
}: {
  given: OwnedShare[];
  received: ReceivedShare[];
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form
        action={async (formData) => {
          setIsSubmitting(true);
          try {
            await createCalendarShareAction(formData);
          } finally {
            setIsSubmitting(false);
          }
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-zinc-500">Friend&apos;s email</span>
          <input type="email" name="email" required placeholder="friend@example.com" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">They can see</span>
          <select name="permission" defaultValue="BUSY_ONLY" className={inputClass}>
            <option value="BUSY_ONLY">Busy times only</option>
            <option value="FULL_DETAILS">Full details</option>
          </select>
        </label>
        <Button type="submit" pending={isSubmitting}>
          Share
        </Button>
      </form>

      {given.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-500">You&apos;ve shared with</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {given.map((share) => (
              <li
                key={share.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-600"
              >
                <span className="min-w-0 truncate">
                  {share.sharedWithName ?? share.sharedWithEmail}{" "}
                  <span className="text-xs text-zinc-400">({PERMISSION_LABEL[share.permission]})</span>
                </span>
                <form action={deleteCalendarShareAction.bind(null, share.id)}>
                  <button
                    type="submit"
                    className="flex-shrink-0 text-xs text-zinc-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                  >
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      {received.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-500">Shared with you</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {received.map((share) => (
              <li key={share.id} className="flex items-center justify-between gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="min-w-0 truncate">
                  {share.ownerName ?? share.ownerEmail}{" "}
                  <span className="text-xs text-zinc-400">({PERMISSION_LABEL[share.permission]})</span>
                </span>
                <label className="flex flex-shrink-0 items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    defaultChecked={!share.hidden}
                    onChange={(e) => setCalendarShareHiddenAction(share.id, !e.target.checked)}
                  />
                  Show on my calendar
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
