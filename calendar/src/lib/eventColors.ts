// Shared Tailwind color-family palette for task/event/project color
// pickers and calendar block styling. Lives outside CalendarClient.tsx
// so EventModal/TaskModal (which need the option list for their Color
// select) can import it without a circular import back into the
// component that renders them.
// `bar` (the border-left accent) is used everywhere a color shows up:
// the week/day hour grid's event blocks, the mobile agenda list, task
// badges. `bg`/`text` are only used by the mobile agenda list's chip
// rows (AgendaView in CalendarClient.tsx) — the desktop hour grid's
// blocks intentionally use a fixed neutral/translucent fill instead (see
// EventBlock), not a per-color one, so they read consistently regardless
// of which color a task's project happens to be.
// `dot`/`badge` are the plain swatch treatments (a small colored circle,
// or a light-bg/dark-text label chip) used by the Projects/Gantt/Tasks
// pages — previously each of those files kept its own copy of this same
// 8-entry map (Tailwind's class scanner just needs the literal strings
// to exist *somewhere* in scanned source, not at their usage site, so
// there was never a technical reason for four separate copies).
export const PROJECT_EVENT_COLORS: Record<
  string,
  { bar: string; bg: string; text: string; dot: string; badge: string }
> = {
  zinc: {
    bar: "border-l-zinc-500",
    bg: "bg-zinc-50 dark:bg-zinc-700",
    text: "text-zinc-900 dark:text-zinc-100",
    dot: "bg-zinc-400",
    badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  },
  red: {
    bar: "border-l-red-500",
    bg: "bg-red-50 dark:bg-red-950",
    text: "text-red-900 dark:text-red-100",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
  amber: {
    bar: "border-l-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950",
    text: "text-amber-900 dark:text-amber-100",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  green: {
    bar: "border-l-green-500",
    bg: "bg-green-50 dark:bg-green-950",
    text: "text-green-900 dark:text-green-100",
    dot: "bg-green-500",
    badge: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  },
  blue: {
    bar: "border-l-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950",
    text: "text-blue-900 dark:text-blue-100",
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  indigo: {
    bar: "border-l-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-950",
    text: "text-indigo-900 dark:text-indigo-100",
    dot: "bg-indigo-500",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  },
  violet: {
    bar: "border-l-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950",
    text: "text-violet-900 dark:text-violet-100",
    dot: "bg-violet-500",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  },
  pink: {
    bar: "border-l-pink-500",
    bg: "bg-pink-50 dark:bg-pink-950",
    text: "text-pink-900 dark:text-pink-100",
    dot: "bg-pink-500",
    badge: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  },
};

// A task/event with no project color set shouldn't grab a random hue
// from the categorical palette above — that reads as an arbitrary,
// unintentional accent (this used to default to `indigo`, which showed
// up as a jarring saturated blue bar on every uncategorized event).
// Neutral, using the same tokens as the rest of the app, so an
// unassigned event just recedes instead of competing for attention.
export const DEFAULT_EVENT_COLOR = {
  bar: "border-l-muted",
  bg: "bg-rule-soft",
  text: "text-ink-2",
  dot: "bg-muted",
  badge: "bg-rule-soft text-ink-2",
};
