"use client";

import { useState } from "react";
import {
  createBookingLinkAction,
  updateBookingLinkAction,
  toggleBookingLinkAction,
  deleteBookingLinkAction,
} from "../actions";
import Button from "../ui/Button";

const DURATION_PRESETS_MIN = [15, 30, 45, 60, 90];
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export type BookingLinkData = {
  id: string;
  slug: string;
  title: string;
  durationMin: number;
  enabled: boolean;
  excludeDays: string | null;
  minNoticeMin: number;
  maxPerDay: number | null;
};

function LinkFields({ defaults }: { defaults?: BookingLinkData }) {
  const [excluded, setExcluded] = useState<string[]>(
    () => defaults?.excludeDays?.split(",").filter(Boolean) ?? [],
  );
  const toggleDay = (code: string) => {
    setExcluded((prev) => (prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code]));
  };
  return (
    <>
      <input type="hidden" name="excludeDays" value={excluded.join(",")} />
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">No-meeting days</span>
        <div className="flex gap-1.5">
          {WEEKDAY_CODES.map((code, idx) => {
            const selected = excluded.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleDay(code)}
                className={
                  selected
                    ? "flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
                    : "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }
              >
                {WEEKDAY_LABELS[idx]}
              </button>
            );
          })}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">URL slug</span>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">/book/</span>
          <input
            type="text"
            name="slug"
            defaultValue={defaults?.slug ?? ""}
            placeholder="quick-chat"
            required
            className="w-40 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
        </div>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Title</span>
        <input
          type="text"
          name="title"
          defaultValue={defaults?.title ?? ""}
          placeholder="Quick chat"
          required
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Duration</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="durationMin"
            defaultValue={defaults?.durationMin ?? 30}
            min={5}
            max={240}
            step={5}
            list="booking-duration-presets"
            aria-label="Booking duration in minutes"
            className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          <span className="text-zinc-500">minutes</span>
        </div>
        <datalist id="booking-duration-presets">
          {DURATION_PRESETS_MIN.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Minimum notice</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="minNoticeMin"
            defaultValue={defaults?.minNoticeMin ?? 60}
            min={0}
            max={10_080}
            step={15}
            aria-label="Minimum notice in minutes"
            className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          <span className="text-zinc-500">minutes before a booking can start</span>
        </div>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Max bookings per day</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="maxPerDay"
            defaultValue={defaults?.maxPerDay ?? ""}
            min={1}
            max={100}
            placeholder="Unlimited"
            aria-label="Maximum bookings per day"
            className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          <span className="text-zinc-500">leave blank for unlimited</span>
        </div>
      </label>
    </>
  );
}

function BookingLinkRow({ link }: { link: BookingLinkData }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        action={async (formData) => {
          await updateBookingLinkAction(link.id, formData);
          setEditing(false);
        }}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-600"
      >
        <LinkFields defaults={link} />
        <div className="flex items-center gap-2">
          <Button type="submit">Save</Button>
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{link.title}</p>
        <p className="text-xs text-zinc-400">
          /book/{link.slug} · {link.durationMin} min
          {link.excludeDays && ` · no ${link.excludeDays.split(",").join("/")}`}
          {link.minNoticeMin > 0 && ` · ${link.minNoticeMin}min notice`}
          {link.maxPerDay != null && ` · max ${link.maxPerDay}/day`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {link.enabled && (
          <a
            href={`/book/${link.slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            Open
          </a>
        )}
        <form action={toggleBookingLinkAction.bind(null, link.id, !link.enabled)}>
          <button
            type="submit"
            className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
          >
            {link.enabled ? "Disable" : "Enable"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
        >
          Edit
        </button>
        <form action={deleteBookingLinkAction.bind(null, link.id)}>
          <button
            type="submit"
            className="rounded-full px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}

export default function BookingLinksManager({ links }: { links: BookingLinkData[] }) {
  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => (
        <BookingLinkRow key={link.id} link={link} />
      ))}
      {links.length === 0 && (
        <p className="text-sm text-zinc-400">No booking links yet.</p>
      )}

      <details className="mt-1">
        <summary className="cursor-pointer list-none text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          + Add booking link
        </summary>
        <form action={createBookingLinkAction} className="mt-3 flex flex-col gap-3">
          <LinkFields />
          <div>
            <Button type="submit">Add link</Button>
          </div>
        </form>
      </details>
    </div>
  );
}
