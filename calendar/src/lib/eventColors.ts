// Shared Tailwind color-family palette for task/event/project color
// pickers and calendar block styling. Lives outside CalendarClient.tsx
// so EventModal/TaskModal (which need the option list for their Color
// select) can import it without a circular import back into the
// component that renders them.
export const PROJECT_EVENT_COLORS: Record<
  string,
  { bar: string; bg: string; text: string }
> = {
  zinc: { bar: "border-l-zinc-500", bg: "bg-zinc-50 dark:bg-zinc-700/40", text: "text-zinc-900 dark:text-zinc-100" },
  red: { bar: "border-l-red-500", bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-900 dark:text-red-100" },
  amber: { bar: "border-l-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-900 dark:text-amber-100" },
  green: { bar: "border-l-green-500", bg: "bg-green-50 dark:bg-green-950/30", text: "text-green-900 dark:text-green-100" },
  blue: { bar: "border-l-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-900 dark:text-blue-100" },
  indigo: { bar: "border-l-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-950/30", text: "text-indigo-900 dark:text-indigo-100" },
  violet: { bar: "border-l-violet-500", bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-900 dark:text-violet-100" },
  pink: { bar: "border-l-pink-500", bg: "bg-pink-50 dark:bg-pink-950/30", text: "text-pink-900 dark:text-pink-100" },
};

export const DEFAULT_EVENT_COLOR = PROJECT_EVENT_COLORS.indigo;
