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
      <div className="mt-6 inline-flex items-center gap-1 rounded-full bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={
              active === tab.key
                ? "rounded-full bg-white px-3 py-1.5 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "rounded-full px-3 py-1.5 text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
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
