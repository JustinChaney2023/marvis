import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser, getCurrentSessionId } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { getRealtimeFactor } from "@/lib/recordings";
import {
  connectAppleAction,
  disconnectAppleAction,
  updateAiSettingsAction,
  updateSchedulingSettingsAction,
  setUserTimezoneAction,
} from "../actions";
import GoogleAccountsManager from "./GoogleAccountsManager";
import AppleSyncButton from "./AppleSyncButton";
import ShareAvailabilityButton from "./ShareAvailabilityButton";
import BookingLinksManager from "./BookingLinksManager";
import CalendarSharingManager from "./CalendarSharingManager";
import IcsImportForm from "./IcsImportForm";
import CalendarSubscriptionsManager from "./CalendarSubscriptionsManager";
import ApiTokensManager from "./ApiTokensManager";
import AutomationRulesManager from "./AutomationRulesManager";
import HabitsManager from "./HabitsManager";
import TimeSlotsManager from "./TimeSlotsManager";
import TranscriptionSettings from "./TranscriptionSettings";
import SettingsTabs from "./SettingsTabs";
import Button from "../ui/Button";
import {
  changePasswordAction,
  logoutAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "../authActions";

function minutesToTimeInput(min: number) {
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export default async function SettingsPage(props: PageProps<"/settings">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const connected = sp?.google_connected === "1";
  const error = typeof sp?.google_error === "string" ? sp.google_error : null;
  const passwordError = typeof sp?.password_error === "string" ? sp.password_error : null;
  const passwordChanged = sp?.password_changed === "1";
  const appleError = typeof sp?.apple_error === "string" ? sp.apple_error : null;

  const googleAccounts = await prisma.googleAccount.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, email: true, label: true, isDefault: true, lastSyncedAt: true, calendarId: true },
  });
  const appleAccount = await prisma.appleAccount.findUnique({ where: { userId: user.id } });
  const calendarSubscriptions = await prisma.calendarSubscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const settings = await getAppSettings(user.id);
  const transcribeRealtimeFactor = await getRealtimeFactor(user.id);
  const apiTokens = await prisma.personalAccessToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  const bookingLinks = await prisma.bookingLink.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const automationRules = await prisma.automationRule.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const habits = await prisma.habit.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const timeSlots = await prisma.timeSlot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const sharesGiven = await prisma.calendarShare.findMany({
    where: { ownerId: user.id },
    include: { sharedWith: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const sharesReceived = await prisma.calendarShare.findMany({
    where: { sharedWithId: user.id },
    include: { owner: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const currentSessionId = await getCurrentSessionId();
  const sessions = await prisma.session.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

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

      <SettingsTabs
        tabs={[
          {
            key: "scheduling",
            label: "Scheduling",
            content: (
              <>
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Scheduling</h2>
        <form action={setUserTimezoneAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">
              Your timezone{" "}
              <span className="text-zinc-400">
                — the scheduler, booking page, and Google export all use this
              </span>
            </span>
            <input
              type="text"
              name="timezone"
              list="timezones"
              required
              defaultValue={user.timezone ?? ""}
              placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
              className="w-56 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
          <Button type="submit" variant="secondary">
            Save timezone
          </Button>
          {!user.timezone && (
            <span className="text-xs text-zinc-400">
              Auto-detected from your browser once you visit any other page —
              set it here to override.
            </span>
          )}
        </form>
        <form
          action={updateSchedulingSettingsAction}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Working hours</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {["SU", "MO", "TU", "WE", "TH", "FR", "SA"].map((code) => (
                <label
                  key={code}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 transition-colors has-checked:border-indigo-600 has-checked:bg-indigo-600 has-checked:text-white dark:border-zinc-600 dark:text-zinc-400"
                >
                  <input
                    type="checkbox"
                    name="workDays"
                    value={code}
                    defaultChecked={settings.workDays.split(",").includes(code)}
                    className="sr-only"
                  />
                  {code[0]}
                  {code[1].toLowerCase()}
                </label>
              ))}
              <input
                type="time"
                name="workStartMin"
                defaultValue={minutesToTimeInput(settings.workStartMin)}
                className="ml-2 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-zinc-500">to</span>
              <input
                type="time"
                name="workEndMin"
                defaultValue={minutesToTimeInput(settings.workEndMin)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">World clock</span>
            <input
              type="text"
              name="secondaryTimezone"
              list="timezones"
              defaultValue={settings.secondaryTimezone ?? ""}
              placeholder="None"
              className="w-44 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            />
            <datalist id="timezones">
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
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
                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-zinc-500">minutes</span>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Daily cap (breathing room)</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="dailyCapMin"
                defaultValue={settings.dailyCapMin ?? ""}
                placeholder="No cap"
                min={30}
                max={960}
                step={15}
                className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-zinc-500">minutes</span>
            </div>
          </label>
          <Button type="submit">Save</Button>
        </form>
        <p className="mt-2 text-xs text-zinc-400">
          The auto-scheduler leaves at least the buffer gap around every
          event, and — if a daily cap is set — stops placing new tasks on
          a day once that many minutes are already scheduled, leaving
          slack for whatever unplanned work shows up. Leave the cap blank
          for no limit.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">AI / local model</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/tasks/import" className="text-indigo-600 dark:text-indigo-400">
            Import
          </Link>{" "}
          uses Claude by default. Point it at any OpenAI-compatible
          endpoint instead — a self-hosted model (Ollama on a desktop,
          reachable over Tailscale) or a hosted API like MiniMax — and it
          stops depending on a Claude subscription entirely.
        </p>
        <form action={updateAiSettingsAction} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Local/hosted AI URL</span>
            <input
              type="url"
              name="localAiUrl"
              defaultValue={settings.localAiUrl ?? ""}
              placeholder="http://100.x.x.x:11434/v1 or https://api.minimax.io/v1"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
            <span className="text-xs text-zinc-400">
              The OpenAI-compatible base URL — Ollama serves this at{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">/v1</code>;
              MiniMax&apos;s is <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">https://api.minimax.io/v1</code>.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Model name</span>
            <input
              type="text"
              name="localAiModel"
              defaultValue={settings.localAiModel ?? ""}
              placeholder="llama3.1 or MiniMax-M1"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">
              API key <span className="text-zinc-400">(only needed for a hosted API like MiniMax — leave blank for an unauthenticated local Ollama/LM Studio)</span>
            </span>
            <input
              type="password"
              name="localAiApiKey"
              placeholder={settings.localAiApiKey ? "•••••••• (saved — leave blank to keep)" : "sk-..."}
              autoComplete="off"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
            {settings.localAiApiKey && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" name="clearLocalAiApiKey" />
                Clear saved key
              </label>
            )}
          </label>
          <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">
                Claude API key <span className="text-zinc-400">(overrides the server&apos;s <code>ANTHROPIC_API_KEY</code> for your account — no .env edit needed)</span>
              </span>
              <input
                type="password"
                name="anthropicApiKey"
                placeholder={settings.anthropicApiKey ? "•••••••• (saved — leave blank to keep)" : "sk-ant-..."}
                autoComplete="off"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              {settings.anthropicApiKey && (
                <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <input type="checkbox" name="clearAnthropicApiKey" />
                  Clear saved key
                </label>
              )}
            </label>
          </div>
          <TranscriptionSettings
            transcribeUrl={settings.transcribeUrl ?? ""}
            transcribeModel={settings.transcribeModel ?? ""}
            hasApiKey={Boolean(settings.transcribeApiKey)}
            realtimeFactor={transcribeRealtimeFactor}
          />
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-zinc-400">
          Leave the URL/model blank to use Claude. Without a Claude API
          key saved here, it falls back to <code>ANTHROPIC_API_KEY</code> in
          your server&apos;s <code>.env</code>.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Automations</h2>
        <p className="mt-1 text-xs text-zinc-400">
          When a task&apos;s status changes to X (optionally, only within a
          specific project), automatically do Y — reusing the AI subtask/
          email-draft features already in this app.
        </p>
        <div className="mt-3">
          <AutomationRulesManager rules={automationRules} projects={projects} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Habits</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Flexible routine time — "exercise 3x a week" rather than a fixed
          recurring event. Placed into open slots each week, and re-placed
          (not dropped) if something else gets booked over a slot.
        </p>
        <div className="mt-3">
          <HabitsManager habits={habits} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Time slots</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Named availability windows (Work, Sleep, School, or your own) —
          assign a task to one on its edit form and the scheduler only
          places it within that slot's days/hours instead of the default
          9am-6pm weekdays.
        </p>
        <div className="mt-3">
          <TimeSlotsManager timeSlots={timeSlots} />
        </div>
      </section>
              </>
            ),
          },
          {
            key: "calendars",
            label: "Calendars",
            content: (
              <>
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Booking pages</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Each link is its own public page with its own slug, title, and
          duration — e.g. a 15-min quick chat vs. a 30-min deep dive. Bookings
          land as locked events on your calendar.
        </p>
        <div className="mt-3">
          <BookingLinksManager links={bookingLinks} />
        </div>
        <div className="mt-3">
          <ShareAvailabilityButton />
          <p className="mt-1 text-xs text-zinc-400">
            Copies a plain-text list of your open times — for pasting into
            an email or DM instead of sending a link.
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Import / export (.ics)</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Export your whole calendar as a standard .ics file, or import one
          from another app. Imported events are plain local events — not a
          two-way sync like Google/Apple.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <a
            href="/api/ics/export"
            className="inline-flex rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Export calendar (.ics)
          </a>
          <IcsImportForm />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">API tokens</h2>
        <p className="mt-1 text-xs text-zinc-400">
          For external clients that can&apos;t sign in through the browser,
          like the Obsidian plugin. Each token acts as you — treat it like a
          password.
        </p>
        <div className="mt-3">
          <ApiTokensManager tokens={apiTokens} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Subscribed calendars</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Subscribe to an external calendar by its ICS URL — holidays, a
          friend&apos;s public calendar. Read-only, auto-synced every 6
          hours.
        </p>
        <div className="mt-3">
          <CalendarSubscriptionsManager subscriptions={calendarSubscriptions} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Google Calendar</h2>

        {googleAccounts.length > 0 ? (
          <GoogleAccountsManager accounts={googleAccounts} />
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Not connected. You&apos;ll need a Google Cloud OAuth client
              first — see{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-700">
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

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Apple Calendar</h2>

        {appleAccount ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Connected as <span className="font-medium">{appleAccount.appleId}</span>.
              {appleAccount.lastSyncedAt
                ? ` Last synced ${appleAccount.lastSyncedAt.toLocaleString()}.`
                : " Never synced yet."}
            </p>
            <div className="flex items-center gap-3">
              <AppleSyncButton />
              <form action={disconnectAppleAction}>
                <Button type="submit" variant="secondary">Disconnect</Button>
              </form>
            </div>
            <p className="text-xs text-zinc-400">
              Read-only overlay, not a two-way sync like Google — events pull in
              (past 7 days through the next 90) as locked blocks so the
              scheduler won&apos;t double-book them, but nothing created or
              edited here is ever pushed to iCloud.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {appleError && (
              <p className="text-sm text-red-600 dark:text-red-400">{appleError}</p>
            )}
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Apple has no OAuth login for third-party apps — use an{" "}
              <a
                href="https://support.apple.com/en-us/102654"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 underline dark:text-indigo-400"
              >
                app-specific password
              </a>{" "}
              from your Apple ID account page instead of your real password.
            </p>
            <form action={connectAppleAction} className="flex flex-col gap-3">
              <input
                name="appleId"
                type="email"
                placeholder="you@icloud.com"
                required
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              <input
                name="appPassword"
                type="password"
                placeholder="App-specific password"
                required
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
              />
              <div>
                <Button type="submit">Connect Apple Calendar</Button>
              </div>
            </form>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Calendar sharing</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Share your calendar with another account on this instance — they
          see it overlaid on their own calendar. View-only; they can&apos;t
          edit anything on it.
        </p>
        <div className="mt-3">
          <CalendarSharingManager
            given={sharesGiven.map((s) => ({
              id: s.id,
              sharedWithEmail: s.sharedWith.email,
              sharedWithName: s.sharedWith.name,
              permission: s.permission,
            }))}
            received={sharesReceived.map((s) => ({
              id: s.id,
              ownerEmail: s.owner.email,
              ownerName: s.owner.name,
              permission: s.permission,
              hidden: s.hiddenByRecipient,
            }))}
          />
        </div>
      </section>
              </>
            ),
          },
          {
            key: "account",
            label: "Account",
            content: (
              <>
      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as <span className="font-medium">{user.email}</span>.
        </p>
        <div className="mt-3 flex items-center gap-3">
          {user.isAdmin && (
            <Link
              href="/feedback-inbox"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            >
              Feedback inbox
            </Link>
          )}
          <form action={logoutAction}>
            <Button type="submit" variant="secondary">Log out</Button>
          </form>
        </div>

        <form action={changePasswordAction} className="mt-5 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Change password</h3>
          <div className="flex flex-wrap gap-3">
            <input
              type="password"
              name="currentPassword"
              placeholder="Current password"
              required
              className="min-w-[10rem] flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
            <input
              type="password"
              name="newPassword"
              placeholder="New password (min. 8 characters)"
              required
              minLength={8}
              className="min-w-[10rem] flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          {passwordError && (
            <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>
          )}
          {passwordChanged && (
            <p className="text-sm text-green-600 dark:text-green-400">Password changed.</p>
          )}
          <div>
            <Button type="submit" variant="secondary">Update password</Button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active sessions</h2>
          {sessions.length > 1 && (
            <form action={revokeOtherSessionsAction}>
              <Button type="submit" variant="secondary">Log out everywhere else</Button>
            </form>
          )}
        </div>
        <ul className="mt-3 space-y-2">
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
              >
                <div>
                  <span className="font-medium">
                    {isCurrent ? "This device" : "Other device"}
                  </span>
                  <span className="ml-2 text-xs text-zinc-500">
                    signed in {s.createdAt.toLocaleString()} · expires {s.expiresAt.toLocaleDateString()}
                  </span>
                </div>
                {!isCurrent && (
                  <form action={revokeSessionAction.bind(null, s.id)}>
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                    >
                      Log out
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
              </>
            ),
          },
        ]}
      />
    </main>
  );
}
