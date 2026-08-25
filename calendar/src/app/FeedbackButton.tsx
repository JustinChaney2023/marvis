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
        className="flex h-9 w-9 items-center justify-center rounded-full border border-rule bg-surface text-ink-2 transition-colors hover:bg-rule-soft"
      >
        <MegaphoneIcon />
      </button>

      {open &&
        createPortal(
          <div
            className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setOpen(false);
                setSent(false);
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-panel w-full max-w-sm rounded-2xl border border-rule bg-surface p-6">
              {sent ? (
                <>
                  <p className="font-serif text-xl text-ink">Thanks!</p>
                  <p className="mt-1 text-sm text-muted">
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
                  <h2 className="font-serif text-xl text-ink">Send feedback</h2>
                  <select
                    name="category"
                    defaultValue="SUGGESTION"
                    className="rounded-lg border border-rule bg-surface px-2 py-2 text-sm text-ink"
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
                    className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
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
