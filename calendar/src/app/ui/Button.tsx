"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";

// Single source of truth for the button styles that were previously
// copy-pasted verbatim across ~14 files — they'd already started to
// drift (some had active:scale-[0.98], some didn't; padding varied
// between px-3/py-1.5 and px-4/py-2 for what was meant to be the same
// "secondary" look). Also gets every submit button a real pending state
// for free via useFormStatus, instead of nothing happening visibly while
// a server action is in flight (which invites a double-click double-
// submit on slower connections).
type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 py-2 text-white shadow-sm hover:from-indigo-500 hover:to-indigo-700 active:scale-[0.98] dark:from-indigo-400 dark:to-indigo-500 dark:hover:to-indigo-400",
  // Filled toolbar-style button (bg-white + shadow + ring) — "Schedule
  // all", "Sync now", etc.
  secondary:
    "border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 shadow-sm ring-1 ring-black/5 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60",
  // Border only, no fill/shadow — modal "Cancel" buttons.
  outline:
    "border border-zinc-200 px-3 py-2 text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700",
  danger:
    "border border-red-200 px-3 py-2 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40",
  ghost:
    "px-2.5 py-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  // Explicit override for standalone buttons (onClick handlers with their
  // own isSubmitting state) — inside a <form action={...}>, omit this and
  // useFormStatus reports the real pending state automatically.
  pending?: boolean;
};

export default function Button({
  variant = "primary",
  pending,
  className = "",
  disabled,
  children,
  type,
  ...props
}: Props) {
  const { pending: formPending } = useFormStatus();
  const isPending = pending ?? (type === "submit" ? formPending : false);

  return (
    <button
      type={type}
      disabled={disabled || isPending}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
