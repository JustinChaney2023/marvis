import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { parseQuickCapture } from "@/lib/quickCapture";
import { MarkIcon } from "./icons";
import weekShot from "../../public/marketing/week.jpg";
import tasksShot from "../../public/marketing/tasks.jpg";
import workloadShot from "../../public/marketing/workload.jpg";
import bookShot from "../../public/marketing/phone-book.jpg";
import dayShot from "../../public/marketing/phone-day.jpg";

export const metadata: Metadata = {
  title: "Season: a calendar that schedules your tasks",
  description:
    "Season puts your tasks on your calendar, around your meetings and before their due dates, and moves them when your day changes.",
  openGraph: {
    title: "Season",
    description: "A calendar that schedules your tasks around your meetings, before they're due.",
    images: ["/marketing/week.jpg"],
  },
};

const CONTACT = "contact@useseason.app";
const CAPTURE_EXAMPLE = "essay draft fri 3pm 2h !! #english";
const PRIORITY_NAMES = ["Low", "Medium", "High", "Urgent"];

// The public front door: signed-in visitors go straight to their calendar
// (/home); everyone else, including Google's OAuth review, sees what
// Season is. Screenshots in public/marketing are of the real app.
export default async function MarketingPage(props: PageProps<"/">) {
  if (await getCurrentUser()) {
    const sp = await props.searchParams;
    const query = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])),
    ).toString();
    redirect(query ? `/home?${query}` : "/home");
  }
  const inviteOnly = Boolean(process.env.SIGNUP_INVITE_CODE);

  return (
    <div className="min-h-full bg-paper text-ink">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <MarkIcon className="h-6 w-6" />
          <span className="font-serif text-xl tracking-tight">Season</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a href="#how" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:text-ink md:block">How it works</a>
          <a href="#booking" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:text-ink md:block">Booking</a>
          <a href="#google" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:text-ink md:block">Google Calendar</a>
          <Link href="/login" className="rounded-lg px-3 py-2 text-ink-2 hover:text-ink">Sign in</Link>
          <Link href="/signup" className="rounded-[9px] bg-ink px-4 py-2 font-medium text-paper hover:opacity-85">
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto w-full max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pt-16">
          <h1 className="max-w-3xl font-serif text-5xl leading-[0.95] tracking-tight sm:text-7xl">
            Your to-do list, on your calendar.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-2">
            Season takes the things you need to get done and gives each one a time: between your meetings and
            classes, inside your working hours, before it&apos;s due. When your day changes, it moves them.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="rounded-[9px] bg-ink px-5 py-3 text-sm font-medium text-paper hover:opacity-85"
            >
              Create an account
            </Link>
            <Link
              href="/login"
              className="rounded-[9px] border border-rule px-5 py-3 text-sm font-medium text-ink-2 hover:text-ink"
            >
              Sign in
            </Link>
          </div>
          {inviteOnly && (
            <p className="mt-4 text-sm text-muted">
              Sign-up needs an invite code for now. Email{" "}
              <a href={`mailto:${CONTACT}`} className="underline hover:text-ink">{CONTACT}</a> for one.
            </p>
          )}
        </section>

        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <div className="hidden sm:block">
            <Shot src={weekShot} alt="Season's week view: meetings and classes, with task blocks scheduled in the gaps" priority />
          </div>
          {/* The desktop shot is unreadable at phone width; show the phone app instead. */}
          <div className="flex justify-center sm:hidden">
            <Phone src={dayShot} alt="Season's day agenda on a phone" />
          </div>
        </div>

        <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow as="h2">How it works</Eyebrow>
          <ol className="mt-6 grid gap-10 md:grid-cols-3 md:gap-8">
            <Step n="1" title="Write it down">
              Type a task the way you&apos;d say it. Season reads the day, time, length, priority and project out of
              the sentence.
            </Step>
            <Step n="2" title="Season finds the time">
              It books a block before the due date, in your working hours, with a gap after meetings. Long tasks get
              split into sessions.
            </Step>
            <Step n="3" title="The plan keeps up">
              Miss a block or add a meeting on top of one, and Season moves the work somewhere that still makes the
              deadline.
            </Step>
          </ol>
          <CaptureDemo />
        </section>

        <Feature
          eyebrow="Scheduling"
          title="Deadlines first, and it tells you when something won't fit."
          shot={<Shot src={tasksShot} alt="Season's task list with each task's estimate, due date and scheduled time" />}
        >
          <p>
            Every task has an estimate and, if you want, a due date. Season places the ones with the least room to
            spare first. If an urgent task can&apos;t fit, it moves less urgent work out of the way instead of
            letting the deadline slip.
          </p>
          <ul className="mt-4 space-y-2">
            <Bullet>Hard and soft deadlines, priorities, and tasks that wait on other tasks</Bullet>
            <Bullet>Deep work in the morning and admin in the afternoon, if you mark tasks that way</Bullet>
            <Bullet>A warning on any task whose time ends up after its due date</Bullet>
            <Bullet>Lock a block and Season will never move it</Bullet>
          </ul>
        </Feature>

        <Feature
          eyebrow="Planning"
          title="See an overbooked week before you're in it."
          shot={<Shot src={workloadShot} alt="Season's workload view: each day's meetings and task time against capacity" />}
          flip
        >
          <p>
            The workload view adds up each day&apos;s meetings and task time against the hours you have, and flags
            the days that don&apos;t add up. Set a daily cap and Season leaves the rest of the day open.
          </p>
          <p className="mt-3">
            Time the work with the focus timer and Season shows how your estimates compare with how long things
            actually take.
          </p>
        </Feature>

        <section id="booking" className="mx-auto w-full max-w-6xl scroll-mt-8 px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid items-center gap-12 md:grid-cols-[1fr_auto] md:gap-16">
            <div>
              <Eyebrow>Booking links</Eyebrow>
              <h2 className="mt-3 max-w-xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
                Let people book the time you actually have.
              </h2>
              <p className="mt-5 max-w-xl text-ink-2">
                Share a link and people pick from times you&apos;re free, counting your meetings and the task time
                Season has planned. You choose the length, how much notice you need, how many bookings a day, and
                which days are off limits. Visitors see times in their own timezone.
              </p>
              <p className="mt-3 max-w-xl text-ink-2">
                And on your phone, Season works as an installable app with the same calendar and reminders.
              </p>
            </div>
            <div className="flex justify-center gap-4">
              <Phone src={bookShot} alt="A Season booking page on a phone, listing open times by day" />
              <Phone src={dayShot} alt="Season's day agenda on a phone" className="hidden sm:block" />
            </div>
          </div>
        </section>

        <section id="google" className="border-y border-rule bg-surface">
          <div className="mx-auto grid w-full max-w-6xl scroll-mt-8 gap-10 px-5 py-20 sm:px-8 md:grid-cols-2 md:gap-16">
            <div>
              <Eyebrow>Google Calendar</Eyebrow>
              <h2 className="mt-3 font-serif text-4xl leading-tight tracking-tight">Works with the calendar you already use.</h2>
              <p className="mt-5 text-ink-2">
                Connect one or more Google accounts and Season syncs both ways. Your Google events block time for
                tasks, and what you plan in Season shows up in Google Calendar on every device. Apple Calendar and
                calendar feeds can be added read-only.
              </p>
            </div>
            <div className="rounded-xl border border-rule bg-paper p-6 text-sm text-ink-2">
              <h3 className="font-semibold text-ink">What Season does with your Google data</h3>
              <ul className="mt-3 space-y-2">
                <Bullet>Connecting Google is optional.</Bullet>
                <Bullet>Season reads events from the calendars you pick, to show them and plan around them.</Bullet>
                <Bullet>It creates and updates events in your Google Calendar only for things you add or change in Season.</Bullet>
                <Bullet>It doesn&apos;t sell your data, use it for ads, or use it to train AI models.</Bullet>
                <Bullet>Disconnect any time in Settings, and Season deletes what it imported.</Bullet>
              </ul>
              <p className="mt-4">
                The details are in the <Link href="/privacy" className="underline hover:text-ink">privacy policy</Link>.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow as="h2">Also in Season</Eyebrow>
          <dl className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            <Extra title="Focus">Today&apos;s queue one task at a time, with a timer and an end-of-day review.</Extra>
            <Extra title="Habits">&quot;Gym 3 times a week&quot; gets its own slots, kept topped up.</Extra>
            <Extra title="Projects">Notes, files and a timeline for each project, with tracked time per week.</Extra>
            <Extra title="Recordings">Record a lecture or meeting and get a transcript, a summary and tasks from it.</Extra>
            <Extra title="Claude">Connect Claude through Season&apos;s MCP server to ask about or change your schedule.</Extra>
            <Extra title="Shared calendars">See a teammate&apos;s busy times, or their details if they share them.</Extra>
          </dl>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
          <div className="rounded-2xl bg-ink px-6 py-12 text-paper sm:px-12">
            <h2 className="max-w-2xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
              Put this week&apos;s to-do list on the calendar.
            </h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-[9px] bg-paper px-5 py-3 text-sm font-medium text-ink hover:opacity-90">
                Create an account
              </Link>
              <Link href="/login" className="rounded-[9px] border border-paper/30 px-5 py-3 text-sm font-medium text-paper hover:border-paper/60">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted sm:px-8">
          <span className="flex items-center gap-2">
            <MarkIcon className="h-4 w-4" />
            Season
          </span>
          <nav className="flex flex-wrap gap-5">
            <Link href="/privacy" className="hover:text-ink">Privacy policy</Link>
            <Link href="/terms" className="hover:text-ink">Terms of service</Link>
            <a href={`mailto:${CONTACT}`} className="hover:text-ink">{CONTACT}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Eyebrow({ children, as: Tag = "p" }: { children: ReactNode; as?: "p" | "h2" }) {
  return <Tag className="font-mono text-xs font-normal uppercase tracking-wider text-muted">{children}</Tag>;
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li>
      <span className="font-mono text-sm text-accent">{n}</span>
      <h3 className="mt-2 font-serif text-2xl tracking-tight">{title}</h3>
      <p className="mt-2 text-ink-2">{children}</p>
    </li>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-[0.6em] h-1 w-1 flex-shrink-0 rounded-full bg-ink-2" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function Extra({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-ink">{title}</dt>
      <dd className="mt-1 text-sm text-ink-2">{children}</dd>
    </div>
  );
}

function Shot({ src, alt, priority }: { src: StaticImageData; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.12)]">
      <Image src={src} alt={alt} priority={priority} sizes="(min-width: 1152px) 1088px, 100vw" className="h-auto w-full" />
    </div>
  );
}

function Phone({ src, alt, className = "" }: { src: StaticImageData; alt: string; className?: string }) {
  return (
    <div className={`w-[220px] overflow-hidden rounded-[28px] border border-rule bg-surface p-1.5 sm:w-[240px] ${className}`}>
      <div className="overflow-hidden rounded-[22px]">
        <Image src={src} alt={alt} sizes="240px" className="h-auto w-full" />
      </div>
    </div>
  );
}

function Feature({
  eyebrow,
  title,
  children,
  shot,
  flip = false,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  shot: ReactNode;
  flip?: boolean;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
      <div className={`grid items-center gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16 ${flip ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        <div className={flip ? "lg:order-2" : ""}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-3 font-serif text-4xl leading-tight tracking-tight">{title}</h2>
          <div className="mt-5 text-ink-2">{children}</div>
        </div>
        <div className={flip ? "lg:order-1" : ""}>{shot}</div>
      </div>
    </section>
  );
}

/** The quick-capture example, parsed by the real parser the app uses. */
function CaptureDemo() {
  const parsed = parseQuickCapture(CAPTURE_EXAMPLE);
  const due = parsed.dueAt
    ? parsed.dueAt.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })
    : null;
  const fields: [string, string | null][] = [
    ["Task", parsed.title],
    ["Due", due],
    ["Estimate", parsed.durationMin ? `${parsed.durationMin / 60}h` : null],
    ["Priority", PRIORITY_NAMES[parsed.priority] ?? null],
    ["Project", parsed.projectName],
  ];
  return (
    <div className="mt-14 rounded-xl border border-rule bg-surface p-5 sm:p-6">
      <p className="text-sm text-muted">You type</p>
      <p className="mt-2 rounded-lg border border-rule bg-paper px-4 py-3 font-mono text-sm text-ink sm:text-base">
        {CAPTURE_EXAMPLE}
      </p>
      <p className="mt-5 text-sm text-muted">Season reads</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-xs uppercase tracking-wider text-muted">{k}</dt>
              <dd className="mt-0.5 text-sm text-ink">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
