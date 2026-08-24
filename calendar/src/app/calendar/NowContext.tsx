"use client";

import { createContext, useContext, useMemo, useRef } from "react";

// The "Now" button lives in the left sidebar (next to the mini month
// calendar) but the "scroll the hour grid to the current time" behavior
// it triggers when you're already on today only exists inside
// CalendarClient's HourGrid. They're server-rendered siblings under the
// same page, not parent/child, so a plain prop/ref can't cross between
// them — this tiny context is the one thing they share.
type NowContextValue = {
  register: (fn: (() => void) | null) => void;
  triggerScrollToNow: () => void;
};

const NowContext = createContext<NowContextValue | null>(null);

export function NowProvider({ children }: { children: React.ReactNode }) {
  const fnRef = useRef<(() => void) | null>(null);
  const value = useMemo<NowContextValue>(
    () => ({
      register: (fn) => {
        fnRef.current = fn;
      },
      triggerScrollToNow: () => fnRef.current?.(),
    }),
    [],
  );
  return <NowContext.Provider value={value}>{children}</NowContext.Provider>;
}

export function useNowContext(): NowContextValue {
  const ctx = useContext(NowContext);
  if (!ctx) throw new Error("useNowContext must be used within a NowProvider");
  return ctx;
}
