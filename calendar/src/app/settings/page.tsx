import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/settings";
import {
  disconnectGoogleAction,
  updateBookingSettingsAction,
  updateSchedulingSettingsAction,
} from "../actions";
import SyncButton from "./SyncButton";

const BOOKING_DURATION_PRESETS_MIN = [15, 30, 45, 60, 90];

export default async function SettingsPage(props: PageProps<"/settings">) {
  const sp = await props.searchParams;
  const connected = sp?.google_connected === "1";
  const error = typeof sp?.google_error === "string" ? sp.google_error : null;

  const account = await prisma.googleAccount.findFirst();
  const settings = await getAppSettings();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <Link
          href="/tasks"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Tasks
        </Link>
      </div>

      {connected && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
          Google Calendar connected.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          Couldn&apos;t connect: {error}
        </p>
      )}

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Scheduling</h2>
        <form
          action={updateSchedulingSettingsAction}
          className="mt-3 flex items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Buffer between events</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="bufferMin"
                defaultValue={settings.bufferMin}
                min={0}
                max={120}
                step={5}
                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-zinc-500">minutes</span>
            </div>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Save
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-400">
          The auto-scheduler leaves at least this much gap around every
          event when placing a task.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Booking page</h2>
        <form
          action={updateBookingSettingsAction}
          className="mt-3 flex flex-col gap-4"
        >
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="text-zinc-700 dark:text-zinc-300">
              Enable booking page
            </span>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                name="bookingEnabled"
                defaultChecked={settings.bookingEnabled}
                className="peer sr-only"
              />
              <span className="block h-6 w-11 rounded-full bg-zinc-200 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 dark:bg-zinc-700 dark:peer-checked:bg-indigo-500" />
              <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">URL slug</span>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">/book/</span>
              <input
                type="text"
                name="bookingSlug"
                defaultValue={settings.bookingSlug ?? ""}
                placeholder="your-name"
                className="w-48 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            {settings.bookingSlug ? (
              <span className="text-xs text-zinc-400">
                Your page: <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">/book/{settings.bookingSlug}</code>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">
                Letters, numbers, and hyphens. Spaces and punctuation become
                hyphens on save.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Page title</span>
            <input
              type="text"
              name="bookingTitle"
              defaultValue={settings.bookingTitle}
              required
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Duration</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="bookingDurationMin"
                defaultValue={settings.bookingDurationMin}
                min={5}
                max={240}
                step={5}
                list="booking-duration-presets"
                aria-label="Booking duration in minutes"
                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-zinc-500">minutes</span>
            </div>
            <datalist id="booking-duration-presets">
              {BOOKING_DURATION_PRESETS_MIN.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <div>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              Save
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-zinc-400">
          Share a single link that lets visitors pick an open slot. Bookings
          land as locked events on your calendar.
        </p>
        {settings.bookingEnabled && settings.bookingSlug && (
          <a
            href={`/book/${settings.bookingSlug}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />/book/
            {settings.bookingSlug}
          </a>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">Google Calendar</h2>

        {account ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Connected as <span className="font-medium">{account.email}</span>.
              {account.lastSyncedAt
                ? ` Last synced ${account.lastSyncedAt.toLocaleString()}.`
                : " Never synced yet."}
            </p>
            <div className="flex items-center gap-3">
              <SyncButton />
              <form action={disconnectGoogleAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                >
                  Disconnect
                </button>
              </form>
            </div>
            <p className="text-xs text-zinc-400">
              Syncs the last 7 days through the next 90. Local events push to
              Google; Google events pull in as read-synced events. Deleting
              this app&apos;s events also deletes them on Google — deletions
              made directly on Google aren&apos;t detected yet.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Not connected. You&apos;ll need a Google Cloud OAuth client
              first — see{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
                docs/google-calendar-setup.md
              </code>{" "}
              in the repo, then set <code>GOOGLE_CLIENT_ID</code> and{" "}
              <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code>.
            </p>
            <a
              href="/api/google/connect"
              className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              Connect Google Calendar
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
