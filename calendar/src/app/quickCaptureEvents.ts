// Lets any button (the rail's "Quick add", the mobile "+" tab, an empty
// state) open the one global QuickCapture box mounted in layout.tsx,
// without threading state through the tree.
export const QUICK_CAPTURE_EVENT = "season:quick-capture";

export type QuickCaptureMode = "task" | "event";

export function openQuickCapture(mode: QuickCaptureMode = "task") {
  window.dispatchEvent(new CustomEvent<QuickCaptureMode>(QUICK_CAPTURE_EVENT, { detail: mode }));
}
