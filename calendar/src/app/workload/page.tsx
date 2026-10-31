import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { expandEvents } from "@/lib/recurrence";
import { windowFnForWorkingHours } from "@/lib/scheduler";
import { getZonedDateParts, userTimeZone, zonedWallTimeToUtc } from "@/lib/timezone";
import { dayLoads, estimateAccuracy } from "@/lib/workload";

const DAYS_AHEAD = 7;
const LOOKBACK_DAYS = 30;

function hours(min: number): string {
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export default async function WorkloadPage() {
  const user = await requireUser();
  const timeZone = userTimeZone(user);
  const settings = await getAppSettings(user.id);
  const getWindow = windowFnForWorkingHours(settings, timeZone);

  // A server component renders once per request, so "now" is stable here.
  const now = new Date();
  const today = getZonedDateParts(now, timeZone);
  const rangeStart = zonedWallTimeToUtc(today.year, today.month, today.day, 0, 0, timeZone);
  const rangeEnd = zonedWallTimeToUtc(today.year, today.month, today.day + DAYS_AHEAD, 0, 0, timeZone);
  const windows = Array.from({ length: DAYS_AHEAD }, (_, i) =>
    getWindow(zonedWallTimeToUtc(today.year, today.month, today.day + i, 12, 0, timeZone)),
  ).filter((w): w is { start: Date; end: Date } => w !== null);

  const [rows, finished] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId: user.id,
        source: { not: "SUBSCRIBED" },
        OR: [{ start: { lt: rangeEnd }, end: { gt: rangeStart } }, { recurrenceRule: { not: null } }],
      },
    }),
    prisma.task.findMany({
      where: {
        userId: user.id,
        status: "DONE",
        parentId: null,
        updatedAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) },
      },
      select: { id: true, title: true, durationMin: true, trackedMinutes: true },
    }),
  ]);
  const byId = new Map(rows.map((e) => [e.id, e]));
  const events = expandEvents(rows, rangeStart, rangeEnd, timeZone)
    .map((o) => {
      const master = byId.get(o.masterId);
      const outOfOffice = master?.eventType === "OUT_OF_OFFICE";
      return { start: o.start, end: o.end, isTask: Boolean(master?.taskId), outOfOffice, allDay: o.allDay };
    })
    // All-day events are labels on the day, except Out of office.
    .filter((e) => !e.allDay || e.outOfOffice);

  const loads = dayLoads(windows, events, settings.dailyCapMin);
  const accuracy = estimateAccuracy(finished);
  const weekDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-serif text-4xl leading-none text-ink">Workload</h1>
      <p className="mt-2 text-sm text-ink-2">
        How full your next week is, and how your estimates compare with the time you actually track.
      </p>

      <section className="mt-6 rounded-xl border border-rule bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">Next 7 days</h2>
          <span className="text-xs text-muted">
            {settings.dailyCapMin ? `Daily cap ${hours(settings.dailyCapMin)}` : "Capacity = working hours"}
          </span>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-ink-2" />Meetings</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" />Task blocks</span>
        </div>
        <ul className="mt-3 flex flex-col gap-3">
          {loads.map((d) => {
            const booked = d.meetingMin + d.taskMin;
            const over = booked - d.capacityMin;
            const scale = Math.max(d.capacityMin, booked) || 1;
            return (
              <li key={d.day.toISOString()}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink-2">{weekDay.format(d.day)}</span>
                  <span className={`font-mono text-xs ${over > 0 ? "text-accent" : "text-muted"}`}>
                    {d.outOfOffice
                      ? "Out of office"
                      : over > 0
                        ? `${hours(booked)} / ${hours(d.capacityMin)} · over by ${hours(over)}`
                        : `${hours(booked)} / ${hours(d.capacityMin)} · ${hours(d.capacityMin - booked)} free`}
                  </span>
                </div>
                <div className="relative mt-1 flex h-2.5 overflow-hidden rounded-full bg-rule-soft">
                  <div className="h-full bg-ink-2" style={{ width: `${(d.meetingMin / scale) * 100}%` }} />
                  <div className="h-full bg-accent" style={{ width: `${(d.taskMin / scale) * 100}%` }} />
                  {over > 0 && (
                    <div
                      className="absolute top-0 h-full w-px bg-ink"
                      style={{ left: `${(d.capacityMin / scale) * 100}%` }}
                      title="Capacity"
                    />
                  )}
                </div>
              </li>
            );
          })}
          {loads.length === 0 && <li className="text-sm text-muted">No working days in the next week.</li>}
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-rule bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Estimates vs. actual</h2>
        <p className="mt-0.5 text-xs text-muted">
          Tasks finished in the last {LOOKBACK_DAYS} days that have time tracked with the timer.
        </p>
        {accuracy.ratio === null ? (
          <p className="mt-3 text-sm text-muted">
            Nothing to compare yet. Start the timer on a task (on <Link href="/focus" className="underline">Focus</Link> or
            the task itself) and finish it to see how your estimates hold up.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-ink">
              {accuracy.count} task{accuracy.count === 1 ? "" : "s"}: estimated {hours(accuracy.estimateMin)}, took{" "}
              {hours(accuracy.actualMin)}.{" "}
              {accuracy.ratio > 1.1
                ? `Tasks take you about ${accuracy.ratio.toFixed(1)}× your estimate, so consider padding new estimates.`
                : accuracy.ratio < 0.9
                  ? `You finish in about ${Math.round(accuracy.ratio * 100)}% of the estimate, so your estimates run high.`
                  : "Your estimates are on target."}
            </p>
            {accuracy.biggestMisses.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {accuracy.biggestMisses.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-ink-2">{m.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {hours(m.estimateMin)} → {hours(m.actualMin)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
