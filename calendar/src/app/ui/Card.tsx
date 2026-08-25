import type { HTMLAttributes } from "react";

// Single source of truth for the "section/card" wrapper that was
// copy-pasted across Settings, Team, and the calendar sidebars — same
// drift problem Button.tsx already solved for buttons.
type Padding = "sm" | "md" | "lg";

// Flat: border only, no shadow/ring, anywhere — not just at rest. A
// resting card shouldn't carry elevation, and this system doesn't have
// any elevation to give it: modals and popovers use a scrim, not a
// shadow, to read as "above" the page.
const BASE = "rounded-xl border border-rule bg-surface";

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
