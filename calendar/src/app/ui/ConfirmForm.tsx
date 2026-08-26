"use client";

import type { ComponentProps } from "react";

// Wraps a server-action <form> so submitting it asks for confirmation first.
// Native window.confirm — no modal component needed for a yes/no gate.
export function ConfirmForm({
  message,
  onSubmit,
  ...props
}: ComponentProps<"form"> & { message: string }) {
  return (
    <form
      {...props}
      onSubmit={(e) => {
        if (!confirm(message)) {
          e.preventDefault();
          return;
        }
        onSubmit?.(e);
      }}
    />
  );
}
