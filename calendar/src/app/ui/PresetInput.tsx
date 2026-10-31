"use client";

import { useEffect, useRef, useState } from "react";

type Preset = { value: string; label: string };

type Props = {
  name: string;
  value: string;
  onChange: (v: string) => void;
  presets: Preset[];
  type?: "number" | "time";
  suffix?: string;
  min?: number;
  step?: number;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
};

/**
 * A plain, still-typeable input that also opens a DatePicker-style popover
 * of common values on click/focus — clicking anywhere in the field shows
 * the presets, no separate dropdown arrow to hunt for.
 */
export default function PresetInput({
  name,
  value,
  onChange,
  presets,
  type = "number",
  suffix,
  min,
  step,
  placeholder,
  ariaLabel,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1.5">
        <input
          type={type}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          min={min}
          step={step}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={className}
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 flex w-full flex-col gap-0.5 rounded-xl border border-rule bg-surface p-1.5">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                onChange(p.value);
                setOpen(false);
              }}
              className="w-full rounded-md px-2 py-1 text-left text-xs text-ink-2 transition-colors hover:bg-rule-soft"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
