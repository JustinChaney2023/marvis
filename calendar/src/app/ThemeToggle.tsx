"use client";

import { useState, useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "./icons";

function subscribe() {
  return () => {};
}
function getSnapshot(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}
function getServerSnapshot(): boolean {
  return false;
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("theme", dark ? "dark" : "light");
}

export default function ThemeToggle() {
  // useSyncExternalStore gives a correct read of the real DOM state once
  // hydrated (the inline pre-paint script in layout.tsx already applied
  // it) without the SSR/hydration mismatch a plain effect+setState would
  // hit — getServerSnapshot's `false` never actually paints wrong, since
  // the CSS class was already set before React ran.
  const domIsDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // classList has no change event to subscribe to, and this component is
  // the only thing that ever flips it, so a local override just tracks
  // our own clicks instead of re-deriving from the DOM every time.
  const [override, setOverride] = useState<boolean | null>(null);
  const isDark = override ?? domIsDark;

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(!isDark);
        setOverride(!isDark);
      }}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-rule bg-surface text-ink-2 transition-colors hover:bg-rule-soft"
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
