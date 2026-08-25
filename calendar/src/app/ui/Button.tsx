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
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  // Flat monochrome (zinc-900/white, flipped in dark mode) rather than a
  // colored gradient — the one color this app spends on hierarchy is
  // reserved for state (today, links, focus), not painted onto every
  // primary action.
  primary:
    "bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700 active:scale-[0.98] dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200",
  // Filled toolbar-style button — "Schedule all", "Sync now", etc. Flat:
  // border only, no shadow/ring, so it doesn't compete with primary.
  secondary:
    "border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60",
  // Border only, no fill — modal "Cancel" buttons.
  outline:
    "border border-zinc-200 px-3 py-2 text-zinc-700 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700",
  danger:
    "border border-red-200 px-3 py-2 text-red-700 hover:bg-red-50 active:scale-[0.98] dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40",
  ghost:
    "px-2.5 py-1 text-zinc-500 hover:text-zinc-900 active:scale-[0.98] dark:hover:text-zinc-100",
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
