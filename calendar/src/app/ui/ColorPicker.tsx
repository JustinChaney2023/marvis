"use client";

import { useState } from "react";
import { PROJECT_EVENT_COLORS, isCustomColor } from "@/lib/eventColors";

const PRESET_COLORS = Object.keys(PROJECT_EVENT_COLORS);

type Props = {
  name: string;
  defaultValue: string; // a preset key, a "#rrggbb" hex, or "" for none
  noneLabel: string;
};

/**
 * Swatch-button color picker: the curated preset palette plus a native
 * `<input type="color">` swatch for anything else. Submits as a plain
 * hidden form field, same as the `<select>` it replaces, so the server
 * actions (which just read `formData.get("color")` as a free string)
 * need no changes for either preset or custom hex values.
 */
export default function ColorPicker({ name, defaultValue, noneLabel }: Props) {
  const [value, setValue] = useState(defaultValue);
  const custom = isCustomColor(value);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setValue("")}
        title={noneLabel}
        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 bg-rule-soft text-[10px] text-ink-2 ${
          value === "" ? "border-accent" : "border-transparent"
        }`}
      >
        ×
      </button>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setValue(c)}
          title={c}
          className={`h-6 w-6 rounded-full border-2 ${PROJECT_EVENT_COLORS[c].dot} ${
            value === c ? "border-accent" : "border-transparent"
          }`}
        />
      ))}
      <label
        title="Custom color"
        className={`relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${
          custom ? "border-accent" : "border-transparent"
        }`}
        style={{
          background: custom
            ? value
            : "conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444)",
        }}
      >
        <input
          type="color"
          value={custom ? value : "#888888"}
          onChange={(e) => setValue(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
