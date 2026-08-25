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
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="modal-panel w-full max-w-sm rounded-2xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Keyboard shortcuts</h2>
        <div className="mt-3 flex flex-col gap-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="font-mono text-[10px] tracking-wide text-muted uppercase">
                {group.title}
              </h3>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {group.shortcuts.map(([keys, desc]) => (
                  <li key={keys} className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">{desc}</span>
                    <kbd className="rounded border border-rule bg-rule-soft px-1.5 py-0.5 font-mono text-xs text-ink-2">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Press Esc to close.</p>
      </div>
    </div>
  );
}
