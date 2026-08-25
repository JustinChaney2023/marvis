import type { HTMLAttributes } from "react";

// Single source of truth for the "section/card" wrapper that was
// copy-pasted across Settings, Team, and the calendar sidebars — same
// drift problem Button.tsx already solved for buttons.
type Padding = "sm" | "md" | "lg";

// Flat: border only, no shadow/ring. A resting card shouldn't carry
// elevation — that's reserved for things actually floating above the
// page (modals, popovers, dropdowns).
const BASE = "rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800";

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
