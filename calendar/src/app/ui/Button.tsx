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
  "inline-flex items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  // Flat ink/paper (flips with the token, not a dark: override) — the
  // one color this app spends on hierarchy is accent, reserved for
  // state (today, mine, due), not painted onto every primary action.
  primary: "bg-ink px-[17px] py-[10px] text-paper hover:opacity-85 active:scale-[0.98]",
  // Filled toolbar-style button — "Schedule all", "Sync now", etc. Flat:
  // border only, no shadow/ring, so it doesn't compete with primary.
  secondary:
    "border border-rule bg-surface px-4 py-[10px] text-ink-2 hover:bg-rule-soft active:scale-[0.98]",
  // Border only, no fill — modal "Cancel" buttons.
  outline: "border border-rule px-4 py-[10px] text-ink-2 hover:text-ink active:scale-[0.98]",
  danger: "border border-accent px-4 py-[10px] text-accent hover:bg-accent-wash active:scale-[0.98]",
  ghost: "px-2.5 py-1 text-muted hover:text-ink active:scale-[0.98]",
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
