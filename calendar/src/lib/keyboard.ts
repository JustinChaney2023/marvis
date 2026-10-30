"use client";

import { useEffect } from "react";

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// A plain module-level counter, not React state — every global single-key
// shortcut handler (quick-capture "c", shortcuts help "?", new-task "n")
// needs to know "is ANY modal open right now," including ones mounted by
// a sibling component it has no other relationship to. Relying on
// isTypingTarget alone only protects a focused text field — a modal with
// focus elsewhere (a button, or focus lost entirely) would otherwise let
// shortcuts fire underneath it and stack overlays.
let openModalCount = 0;

export function isAnyModalOpen(): boolean {
  return openModalCount > 0;
}

/**
 * Registers this component's modal/popup as open for as long as `isOpen`
 * is true — for a component that's always mounted but only sometimes
 * showing a panel (QuickCapture, ShortcutsHelp), pass their own `open`
 * state; for one that's only mounted while open (EventModal, TaskModal,
 * QuickCreatePopup), pass `true`.
 */
export function useModalOpen(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    openModalCount++;
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
    };
  }, [isOpen]);
}
