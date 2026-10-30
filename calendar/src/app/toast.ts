// Fire-and-forget toasts: any client component calls showToast(), the one
// <Toaster /> in layout.tsx renders it. Same window-event pattern as
// quickCaptureEvents.ts — no context provider to thread through.
export const TOAST_EVENT = "season:toast";

export type ToastInput = {
  message: string;
  action?: { label: string; onClick: () => void | Promise<void> };
};

export function showToast(toast: ToastInput) {
  window.dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail: toast }));
}
