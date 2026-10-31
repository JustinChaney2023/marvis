import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy · Season" };

// Public (see PUBLIC_PATH_PREFIXES in proxy.ts) — Google's OAuth consent
// screen links here, and needs it to publish the app out of Testing.
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 text-sm leading-relaxed text-ink-2 sm:px-6 sm:py-12">
      <h1 className="font-serif text-4xl leading-none text-ink">Privacy policy</h1>
      <p className="mt-2 text-xs text-muted">Last updated October 31, 2026</p>

      <p className="mt-6">
        Season (useseason.app) is a personal calendar and task planner. This page explains what it stores, why, and
        what it does with data from your Google account.
      </p>

      <h2 className="mt-6 font-semibold text-ink">What Season stores</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Your account: email address, name, a hashed password, timezone and settings.</li>
        <li>What you put in: events, tasks, projects, notes, files, recordings and feedback.</li>
        <li>Calendar data from accounts you connect (Google Calendar, Apple Calendar, calendar feeds).</li>
      </ul>

      <h2 className="mt-6 font-semibold text-ink">Google user data</h2>
      <p className="mt-2">
        If you connect a Google account, Season asks for your email address and access to Google Calendar. It uses
        them only to show your Google events in Season, keep them in sync in both directions, and plan your tasks
        around them. OAuth tokens are stored encrypted. You can disconnect at any time in Settings → Calendars, which
        stops syncing, or remove access at myaccount.google.com.
      </p>
      <p className="mt-2">
        Season&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="underline hover:text-ink"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Google user data is not sold, not used for advertising, and not
        used to train AI models.
      </p>

      <h2 className="mt-6 font-semibold text-ink">AI features</h2>
      <p className="mt-2">
        Optional AI features (chat, syllabus import, generating subtasks, summaries) send the text needed for that
        request to the AI provider configured for your account, only when you use them.
      </p>

      <h2 className="mt-6 font-semibold text-ink">Sharing</h2>
      <p className="mt-2">
        Your data isn&apos;t sold or shared with third parties, except the services above that you choose to connect
        or use, and people you share a calendar or booking link with.
      </p>

      <h2 className="mt-6 font-semibold text-ink">Deleting your data</h2>
      <p className="mt-2">
        Email{" "}
        <a href="mailto:justingchaney@gmail.com" className="underline hover:text-ink">
          justingchaney@gmail.com
        </a>{" "}
        to have your account and everything in it deleted.
      </p>
    </main>
  );
}
