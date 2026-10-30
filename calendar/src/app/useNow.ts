"use client";

import { useEffect, useState } from "react";

/**
 * The current time as state, re-read every `intervalMs` — for render-time
 * "is this overdue / how many minutes away" math, which can't call
 * Date.now() directly during render (impure, and it'd go stale anyway on
 * a page left open).
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
