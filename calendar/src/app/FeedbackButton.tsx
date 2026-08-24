"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { submitFeedbackAction } from "./actions";
import { MegaphoneIcon } from "./icons";
import Button from "./ui/Button";

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const pathname = usePathname();

  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/book/")
  ) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60"
      >
        <MegaphoneIcon />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setOpen(false);
                setSent(false);
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
              {sent ? (
                <>
                  <p className="text-lg font-semibold">Thanks!</p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Your feedback was sent.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOpen(false);
                      setSent(false);
                    }}
                    className="mt-4"
                  >
                    Close
                  </Button>
                </>
              ) : (
                <form
                  action={async (formData) => {
                    formData.set("page", pathname);
                    await submitFeedbackAction(formData);
                    setSent(true);
                  }}
                  className="flex flex-col gap-3"
                >
                  <h2 className="text-lg font-semibold">Send feedback</h2>
                  <select
                    name="category"
                    defaultValue="SUGGESTION"
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                  >
                    <option value="SUGGESTION">Suggestion</option>
                    <option value="BUG">Bug report</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <textarea
                    name="message"
                    required
                    rows={4}
                    autoFocus
                    placeholder="What's on your mind?"
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">Send</Button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
