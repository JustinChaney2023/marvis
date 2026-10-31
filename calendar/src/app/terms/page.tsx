import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of service · Season" };

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 text-sm leading-relaxed text-ink-2 sm:px-6 sm:py-12">
      <h1 className="font-serif text-4xl leading-none text-ink">Terms of service</h1>
      <p className="mt-2 text-xs text-muted">Last updated October 31, 2026</p>
      <p className="mt-6">
        Season (useseason.app) is a personal project offered as-is, without warranties of any kind. It may change,
        have downtime, or lose data, so keep your own copies of anything important; your connected calendars (like
        Google Calendar) remain the original copy of events synced from them.
      </p>
      <p className="mt-3">
        Don&apos;t use Season to break the law or to abuse other people or services. Accounts used that way may be
        removed.
      </p>
      <p className="mt-3">
        How your data is handled is described in the{" "}
        <a href="/privacy" className="underline hover:text-ink">
          privacy policy
        </a>
        . Questions:{" "}
        <a href="mailto:justingchaney@gmail.com" className="underline hover:text-ink">
          justingchaney@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
