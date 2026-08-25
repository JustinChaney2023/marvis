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
import MarkitdownSettings from "./MarkitdownSettings";
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
        <h1 className="font-serif text-3xl text-ink">Settings</h1>
        <Link
          href="/tasks"
          className="text-sm text-ink-2 transition-colors hover:text-ink"
        >
          ← Tasks
        </Link>
      </div>

      {connected && (
        <p className="mt-4 rounded-lg bg-accent-wash px-3 py-2 text-sm text-ink">
          Google Calendar connected.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-accent-wash px-3 py-2 text-sm text-accent">
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
      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Scheduling</h2>
        <form action={setUserTimezoneAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">
              Your timezone{" "}
              <span className="text-muted">
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
              className="w-56 rounded-lg border border-rule bg-surface px-2 py-2 text-sm"
            />
          </label>
          <Button type="submit" variant="secondary">
            Save timezone
          </Button>
          {!user.timezone && (
            <span className="text-xs text-muted">
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
            <span className="text-ink-2">Working hours</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {["SU", "MO", "TU", "WE", "TH", "FR", "SA"].map((code) => (
                <label
                  key={code}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-rule text-xs font-semibold text-ink-2 transition-colors has-checked:border-ink has-checked:bg-ink has-checked:text-paper"
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
                className="ml-2 rounded-lg border border-rule bg-surface px-2 py-2 text-sm"
              />
              <span className="text-ink-2">to</span>
              <input
                type="time"
                name="workEndMin"
                defaultValue={minutesToTimeInput(settings.workEndMin)}
                className="rounded-lg border border-rule bg-surface px-2 py-2 text-sm"
              />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">World clock</span>
            <input
              type="text"
              name="secondaryTimezone"
              list="timezones"
              defaultValue={settings.secondaryTimezone ?? ""}
              placeholder="None"
              className="w-44 rounded-lg border border-rule bg-surface px-2 py-2 text-sm"
            />
            <datalist id="timezones">
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Buffer between events</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="bufferMin"
                defaultValue={settings.bufferMin}
                min={0}
                max={120}
                step={5}
                className="w-24 rounded-lg border border-rule bg-surface px-2 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
              />
              <span className="text-ink-2">minutes</span>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Daily cap (breathing room)</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="dailyCapMin"
                defaultValue={settings.dailyCapMin ?? ""}
                placeholder="No cap"
                min={30}
                max={960}
                step={15}
                className="w-24 rounded-lg border border-rule bg-surface px-2 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
              />
              <span className="text-ink-2">minutes</span>
            </div>
          </label>
          <Button type="submit">Save</Button>
        </form>
        <p className="mt-2 text-xs text-muted">
          The auto-scheduler leaves at least the buffer gap around every
          event, and — if a daily cap is set — stops placing new tasks on
          a day once that many minutes are already scheduled, leaving
          slack for whatever unplanned work shows up. Leave the cap blank
          for no limit.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">AI / local model</h2>
        <p className="mt-1 text-sm text-ink-2">
          <Link href="/tasks/import" className="text-accent">
            Import
          </Link>{" "}
          uses Claude by default. Point it at any OpenAI-compatible
          endpoint instead — a self-hosted model (Ollama on a desktop,
          reachable over Tailscale) or a hosted API like MiniMax — and it
          stops depending on a Claude subscription entirely.
        </p>
        <form action={updateAiSettingsAction} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Local/hosted AI URL</span>
            <input
              type="url"
              name="localAiUrl"
              defaultValue={settings.localAiUrl ?? ""}
              placeholder="http://100.x.x.x:11434/v1 or https://api.minimax.io/v1"
              className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
            />
            <span className="text-xs text-muted">
              The OpenAI-compatible base URL — Ollama serves this at{" "}
              <code className="rounded bg-rule-soft px-1 py-0.5">/v1</code>;
              MiniMax&apos;s is <code className="rounded bg-rule-soft px-1 py-0.5">https://api.minimax.io/v1</code>.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">Model name</span>
            <input
              type="text"
              name="localAiModel"
              defaultValue={settings.localAiModel ?? ""}
              placeholder="llama3.1 or MiniMax-M1"
              className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink-2">
              API key <span className="text-muted">(only needed for a hosted API like MiniMax — leave blank for an unauthenticated local Ollama/LM Studio)</span>
            </span>
            <input
              type="password"
              name="localAiApiKey"
              placeholder={settings.localAiApiKey ? "•••••••• (saved — leave blank to keep)" : "sk-..."}
              autoComplete="off"
              className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
            />
            {settings.localAiApiKey && (
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" name="clearLocalAiApiKey" />
                Clear saved key
              </label>
            )}
          </label>
          <div className="border-t border-rule pt-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-2">
                Claude API key <span className="text-muted">(overrides the server&apos;s <code>ANTHROPIC_API_KEY</code> for your account — no .env edit needed)</span>
              </span>
              <input
                type="password"
                name="anthropicApiKey"
                placeholder={settings.anthropicApiKey ? "•••••••• (saved — leave blank to keep)" : "sk-ant-..."}
                autoComplete="off"
                className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
              />
              {settings.anthropicApiKey && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
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
          <MarkitdownSettings markitdownUrl={settings.markitdownUrl ?? ""} />
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted">
          Leave the URL/model blank to use Claude. Without a Claude API
          key saved here, it falls back to <code>ANTHROPIC_API_KEY</code> in
          your server&apos;s <code>.env</code>.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Automations</h2>
        <p className="mt-1 text-xs text-muted">
          When a task&apos;s status changes to X (optionally, only within a
          specific project), automatically do Y — reusing the AI subtask/
          email-draft features already in this app.
        </p>
        <div className="mt-3">
          <AutomationRulesManager rules={automationRules} projects={projects} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Habits</h2>
        <p className="mt-1 text-xs text-muted">
          Flexible routine time — "exercise 3x a week" rather than a fixed
          recurring event. Placed into open slots each week, and re-placed
          (not dropped) if something else gets booked over a slot.
        </p>
        <div className="mt-3">
          <HabitsManager habits={habits} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Time slots</h2>
        <p className="mt-1 text-xs text-muted">
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
      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Booking pages</h2>
        <p className="mt-1 text-xs text-muted">
          Each link is its own public page with its own slug, title, and
          duration — e.g. a 15-min quick chat vs. a 30-min deep dive. Bookings
          land as locked events on your calendar.
        </p>
        <div className="mt-3">
          <BookingLinksManager links={bookingLinks} />
        </div>
        <div className="mt-3">
          <ShareAvailabilityButton />
          <p className="mt-1 text-xs text-muted">
            Copies a plain-text list of your open times — for pasting into
            an email or DM instead of sending a link.
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Import / export (.ics)</h2>
        <p className="mt-1 text-xs text-muted">
          Export your whole calendar as a standard .ics file, or import one
          from another app. Imported events are plain local events — not a
          two-way sync like Google/Apple.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <a
            href="/api/ics/export"
            className="inline-flex rounded-lg border border-rule px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-rule-soft"
          >
            Export calendar (.ics)
          </a>
          <IcsImportForm />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">API tokens</h2>
        <p className="mt-1 text-xs text-muted">
          For external clients that can&apos;t sign in through the browser,
          like the Obsidian plugin. Each token acts as you — treat it like a
          password.
        </p>
        <div className="mt-3">
          <ApiTokensManager tokens={apiTokens} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Subscribed calendars</h2>
        <p className="mt-1 text-xs text-muted">
          Subscribe to an external calendar by its ICS URL — holidays, a
          friend&apos;s public calendar. Read-only, auto-synced every 6
          hours.
        </p>
        <div className="mt-3">
          <CalendarSubscriptionsManager subscriptions={calendarSubscriptions} />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Google Calendar</h2>

        {googleAccounts.length > 0 ? (
          <GoogleAccountsManager accounts={googleAccounts} />
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-2">
              Not connected. You&apos;ll need a Google Cloud OAuth client
              first — see{" "}
              <code className="rounded bg-rule-soft px-1 py-0.5 text-xs">
                docs/google-calendar-setup.md
              </code>{" "}
              in the repo, then set <code>GOOGLE_CLIENT_ID</code> and{" "}
              <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code>.
            </p>
            <a
              href="/api/google/connect"
              className="inline-flex rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition-all hover:opacity-85 active:scale-[0.98]"
            >
              Connect Google Calendar
            </a>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Apple Calendar</h2>

        {appleAccount ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-2">
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
            <p className="text-xs text-muted">
              Read-only overlay, not a two-way sync like Google — events pull in
              (past 7 days through the next 90) as locked blocks so the
              scheduler won&apos;t double-book them, but nothing created or
              edited here is ever pushed to iCloud.
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {appleError && (
              <p className="text-sm text-accent">{appleError}</p>
            )}
            <p className="text-sm text-ink-2">
              Apple has no OAuth login for third-party apps — use an{" "}
              <a
                href="https://support.apple.com/en-us/102654"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
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
                className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
              />
              <input
                name="appPassword"
                type="password"
                placeholder="App-specific password"
                required
                className="rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
              />
              <div>
                <Button type="submit">Connect Apple Calendar</Button>
              </div>
            </form>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Calendar sharing</h2>
        <p className="mt-1 text-xs text-muted">
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
      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <h2 className="font-serif text-xl text-ink">Account</h2>
        <p className="mt-2 text-sm text-ink-2">
          Signed in as <span className="font-medium">{user.email}</span>.
        </p>
        <div className="mt-3 flex items-center gap-3">
          {user.isAdmin && (
            <Link
              href="/feedback-inbox"
              className="rounded-lg border border-rule bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              Feedback inbox
            </Link>
          )}
          <form action={logoutAction}>
            <Button type="submit" variant="secondary">Log out</Button>
          </form>
        </div>

        <form action={changePasswordAction} className="mt-5 flex flex-col gap-3 border-t border-rule pt-4">
          <h3 className="text-sm font-medium text-ink-2">Change password</h3>
          <div className="flex flex-wrap gap-3">
            <input
              type="password"
              name="currentPassword"
              placeholder="Current password"
              required
              className="min-w-[10rem] flex-1 rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
            />
            <input
              type="password"
              name="newPassword"
              placeholder="New password (min. 8 characters)"
              required
              minLength={8}
              className="min-w-[10rem] flex-1 rounded-lg border border-rule bg-surface px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none"
            />
          </div>
          {passwordError && (
            <p className="text-sm text-accent">{passwordError}</p>
          )}
          {passwordChanged && (
            <p className="text-sm text-ink-2">Password changed.</p>
          )}
          <div>
            <Button type="submit" variant="secondary">Update password</Button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-ink">Active sessions</h2>
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
                className="flex items-center justify-between gap-3 rounded-lg border border-rule px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">
                    {isCurrent ? "This device" : "Other device"}
                  </span>
                  <span className="ml-2 text-xs text-ink-2">
                    signed in {s.createdAt.toLocaleString()} · expires {s.expiresAt.toLocaleDateString()}
                  </span>
                </div>
                {!isCurrent && (
                  <form action={revokeSessionAction.bind(null, s.id)}>
                    <button
                      type="submit"
                      className="text-xs text-muted transition-colors hover:text-accent"
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
