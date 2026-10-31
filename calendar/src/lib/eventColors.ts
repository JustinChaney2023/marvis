// Shared Tailwind color-family palette for task/event/project color
// pickers and calendar block styling. Lives outside CalendarClient.tsx
// so EventModal/TaskModal (which need the option list for their Color
// select) can import it without a circular import back into the
// component that renders them.
// `bar` is the border-left accent (used by every colored surface —
// hour-grid blocks, agenda rows, task badges). `bg`/`text` fill the
// whole block for colored events and the mobile agenda list, matching
// each other; uncolored events keep a flat neutral fill (EventBlock).
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
  orange: {
    bar: "border-l-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950",
    text: "text-orange-900 dark:text-orange-100",
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  },
  teal: {
    bar: "border-l-teal-500",
    bg: "bg-teal-50 dark:bg-teal-950",
    text: "text-teal-900 dark:text-teal-100",
    dot: "bg-teal-500",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  },
  sky: {
    bar: "border-l-sky-500",
    bg: "bg-sky-50 dark:bg-sky-950",
    text: "text-sky-900 dark:text-sky-100",
    dot: "bg-sky-500",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  emerald: {
    bar: "border-l-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950",
    text: "text-emerald-900 dark:text-emerald-100",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  rose: {
    bar: "border-l-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950",
    text: "text-rose-900 dark:text-rose-100",
    dot: "bg-rose-500",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
};

// A color value is either one of the curated Tailwind family names above,
// or a custom hex string (from the <input type="color"> swatch) — anything
// starting with "#". Hex can't go through Tailwind's class scanner (it
// only picks up literal class strings in source, not runtime-built ones),
// so it's rendered via inline style instead, computed here rather than at
// each of the several render sites that used to duplicate this palette.
export function isCustomColor(color: string | null | undefined): color is string {
  return !!color && color.startsWith("#");
}

// Same five roles as PROJECT_EVENT_COLORS, as inline-style objects instead
// of class strings. `1a`/`33` hex alpha suffixes give the same "soft tint"
// look as the Tailwind -50/-950 backgrounds without needing a palette.
export function customColorStyle(hex: string) {
  return {
    bar: { borderLeftColor: hex } as const,
    bg: { backgroundColor: `${hex}1a` } as const,
    text: { color: hex } as const,
    dot: { backgroundColor: hex } as const,
    badge: { backgroundColor: `${hex}33`, color: hex } as const,
  };
}

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
