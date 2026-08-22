"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchEventsAction } from "../actions";
import { SearchIcon } from "../icons";

type Result = { id: string; title: string; startYMD: string };

// Debounced title search across the user's own events, scoped by
// userId in searchEventsAction — jumps to a match by reusing
// CalendarClient's existing `?edit=<id>` modal-open mechanism, so a
// result click needs no new "open this event" plumbing.
export default function CalendarSearch({ view }: { view: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) return;
    const handle = setTimeout(async () => {
      const found = await searchEventsAction(query);
      setResults(found);
      setOpen(true);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selectResult = (result: Result) => {
    setOpen(false);
    setQuery("");
    router.push(`/?view=${view}&start=${result.startYMD}&edit=${result.id}`);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-800">
        <SearchIcon className="h-3.5 w-3.5 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (!next.trim()) {
              setResults(null);
              setOpen(false);
            }
          }}
          onFocus={() => results && setOpen(true)}
          placeholder="Search events"
          className="w-32 bg-transparent text-sm outline-none placeholder:text-zinc-400 sm:w-40"
        />
      </div>
      {open && results && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
          {results.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-zinc-400">No matching events</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => selectResult(r)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700"
              >
                <span className="truncate">{r.title}</span>
                <span className="shrink-0 text-xs text-zinc-400">{r.startYMD}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
