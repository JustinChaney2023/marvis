"use client";

import { useEffect, useState } from "react";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const GROUPS: { title: string; shortcuts: [string, string][] }[] = [
  {
    title: "Everywhere",
    shortcuts: [
      ["c", "Quick-add a task"],
      ["?", "Toggle this help"],
    ],
  },
  {
    title: "Calendar",
    shortcuts: [
      ["d / w / m", "Switch to day / week / month view"],
      ["t", "Jump to today"],
      ["j / k or ← / →", "Previous / next day, week, or month"],
    ],
  },
  {
    title: "Tasks",
    shortcuts: [["n", "New task"]],
  },
];

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (e.key === "?" && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="modal-panel w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
        <div className="mt-3 flex flex-col gap-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                {group.title}
              </h3>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {group.shortcuts.map(([keys, desc]) => (
                  <li key={keys} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600 dark:text-zinc-300">{desc}</span>
                    <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-400">Press Esc to close.</p>
      </div>
    </div>
  );
}
