import Link from "next/link";

const FEATURES = [
  {
    title: "Tasks that plan themselves",
    body: "Add a task with how long it takes and when it's due. Season finds time for it around your meetings, inside your working hours, and moves it when your day changes.",
  },
  {
    title: "One calendar",
    body: "Your events, task blocks, habits and focus time in one day, week or month view, on desktop or as an installable phone app.",
  },
  {
    title: "Google Calendar sync",
    body: "Connect Google Calendar and Season keeps both sides in step, so your existing meetings block time and the work Season plans shows up in Google too.",
  },
  {
    title: "Booking links",
    body: "Share a link that only offers times you're actually free, with notice and daily limits you set.",
  },
  {
    title: "Focus and workload",
    body: "A focus view for today's queue with a timer, and a workload view that shows when a week is overbooked before it happens.",
  },
  {
    title: "Works with Claude",
    body: "Optional: let Claude read and update your schedule through Season's MCP server.",
  },
];

/** What signed-out visitors see at "/" — explains what Season is. */
export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="font-serif text-5xl leading-none text-ink">Season</h1>
      <p className="mt-4 max-w-xl text-lg text-ink-2">
        A calendar and task planner that schedules your to-do list for you. Tell Season what you need to get done
        and by when; it puts the work on your calendar around everything else and keeps the plan up to date.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-[9px] bg-ink px-[17px] py-[10px] text-[13px] font-medium text-paper hover:opacity-85"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-[9px] border border-rule px-4 py-[10px] text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          Sign in
        </Link>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-xl border border-rule bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">{f.title}</h2>
            <p className="mt-1 text-sm text-ink-2">{f.body}</p>
          </li>
        ))}
      </ul>

      <section className="mt-12 text-sm text-ink-2">
        <h2 className="font-semibold text-ink">How Season uses your Google account</h2>
        <p className="mt-1">
          Connecting Google Calendar is optional. If you connect it, Season reads your events so it can plan around
          them and writes the events and task blocks you create in Season to your calendar. It doesn&apos;t sell
          your data or use it for ads. Details are in the{" "}
          <Link href="/privacy" className="underline hover:text-ink">
            privacy policy
          </Link>
          .
        </p>
      </section>

      <footer className="mt-12 flex flex-wrap gap-4 border-t border-rule pt-4 text-xs text-muted">
        <Link href="/privacy" className="hover:text-ink">Privacy policy</Link>
        <Link href="/terms" className="hover:text-ink">Terms of service</Link>
        <a href="mailto:contact@useseason.app" className="hover:text-ink">contact@useseason.app</a>
      </footer>
    </main>
  );
}
