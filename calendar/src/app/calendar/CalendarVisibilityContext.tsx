"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Which calendars (see CalendarEvent.calendarKey) are unchecked in the
// left sidebar's "My calendars" / "Other calendars" list — same show/hide
// filter as Google Calendar's own sidebar checkboxes. Per-browser only
// (localStorage), same reasoning as a client-only display filter: no
// server round-trip, nothing to sync across devices.
const STORAGE_KEY = "marvis.hiddenCalendars";

type CalendarVisibilityContextValue = {
  isVisible: (calendarKey: string) => boolean;
  toggle: (calendarKey: string) => void;
};

const CalendarVisibilityContext = createContext<CalendarVisibilityContextValue | null>(null);

export function CalendarVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Deliberately in an effect, not a lazy useState initializer: localStorage
    // doesn't exist during SSR, so reading it during render would make the
    // client's first render disagree with the server-rendered HTML.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setHidden(new Set(JSON.parse(raw)));
    } catch {
      // ignore malformed/blocked storage — falls back to "everything visible"
    }
  }, []);

  const value = useMemo<CalendarVisibilityContextValue>(
    () => ({
      isVisible: (calendarKey) => !hidden.has(calendarKey),
      toggle: (calendarKey) => {
        setHidden((prev) => {
          const next = new Set(prev);
          if (next.has(calendarKey)) next.delete(calendarKey);
          else next.add(calendarKey);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
          } catch {
            // ignore
          }
          return next;
        });
      },
    }),
    [hidden],
  );

  return (
    <CalendarVisibilityContext.Provider value={value}>
      {children}
    </CalendarVisibilityContext.Provider>
  );
}

export function useCalendarVisibility(): CalendarVisibilityContextValue {
  const ctx = useContext(CalendarVisibilityContext);
  if (!ctx) throw new Error("useCalendarVisibility must be used within a CalendarVisibilityProvider");
  return ctx;
}
