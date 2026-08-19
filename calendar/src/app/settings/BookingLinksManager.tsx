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

export type BookingLinkData = {
  id: string;
  slug: string;
  title: string;
  durationMin: number;
  enabled: boolean;
};

function LinkFields({ defaults }: { defaults?: BookingLinkData }) {
  return (
    <>
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
