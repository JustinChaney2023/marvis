import type { HTMLAttributes } from "react";

// Single source of truth for the "section/card" wrapper that was
// copy-pasted across Settings, Team, and the calendar sidebars — same
// drift problem Button.tsx already solved for buttons.
type Padding = "sm" | "md" | "lg";

const BASE =
  "rounded-xl border border-zinc-200 bg-white shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800";

const PADDING: Record<Padding, string> = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

type Props = HTMLAttributes<HTMLDivElement> & {
  padding?: Padding;
};

export default function Card({ padding = "md", className = "", children, ...props }: Props) {
  return (
    <div className={`${BASE} ${PADDING[padding]} ${className}`} {...props}>
      {children}
    </div>
  );
}
