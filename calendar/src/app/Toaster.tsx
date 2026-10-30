"use client";

import { useEffect, useRef, useState } from "react";
import { TOAST_EVENT, type ToastInput } from "./toast";

const VISIBLE_MS = 5000;

/** Bottom-of-screen toast, one at a time (a new one replaces the old). */
export default function Toaster() {
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastInput>).detail;
      if (timer.current) clearTimeout(timer.current);
      setToast({ ...detail, id: Date.now() });
      timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      // Sits above MobileNav's tab bar on phones, bottom-center on desktop.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 md:bottom-6 print:hidden"
    >
      <div
        key={toast.id}
        className="modal-panel pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-ink px-4 py-2.5 text-sm text-paper shadow-lg shadow-black/20"
      >
        <span className="min-w-0 truncate">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={async () => {
              setToast(null);
              await toast.action?.onClick();
            }}
            className="flex-shrink-0 font-medium text-accent hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
