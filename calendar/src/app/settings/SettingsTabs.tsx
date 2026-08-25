"use client";

import { useState, type ReactNode } from "react";

export default function SettingsTabs({
  tabs,
}: {
  tabs: { key: string; label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0].key);

  return (
    <div>
      <div className="mt-6 inline-flex items-center gap-1 rounded-full border border-rule bg-surface p-1 text-sm">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={
              active === tab.key
                ? "rounded-full bg-ink px-3 py-1.5 font-medium text-paper"
                : "rounded-full px-3 py-1.5 text-ink-2 transition-colors hover:text-ink"
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
