"use client";

import { useState, type ReactNode } from "react";

export default function SettingsTabs({
  tabs,
  initialTab,
}: {
  tabs: { key: string; label: string; content: ReactNode }[];
  // From /settings?tab=… — lets other pages link straight to a tab.
  initialTab?: string;
}) {
  const [active, setActive] = useState(
    tabs.some((t) => t.key === initialTab) ? initialTab! : tabs[0].key,
  );

  return (
    <div>
      <div className="no-scrollbar mt-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-rule bg-surface p-1 text-sm">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={
              active === tab.key
                ? "flex-shrink-0 rounded-full bg-ink px-3 py-1.5 font-medium text-paper"
                : "flex-shrink-0 rounded-full px-3 py-1.5 text-ink-2 transition-colors hover:text-ink"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} className={active === tab.key ? "" : "hidden"}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
