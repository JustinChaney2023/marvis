/**
 * Numbers behind the Workload page: how full each upcoming work day is
 * (Motion's "capacity" view) and how estimates compare with time actually
 * tracked. Pure functions so they're unit-testable; the page does the
 * fetching.
 */

type Interval = { start: Date; end: Date };

export type DayLoad = {
  day: Date; // the work window's start
  capacityMin: number; // work-window length, or the daily cap if lower
  meetingMin: number;
  taskMin: number;
  outOfOffice: boolean;
};

/** Minutes of `intervals` inside `window`, overlaps counted once. */
export function minutesWithin(intervals: Interval[], window: Interval): number {
  const clipped = intervals
    .map((i) => ({
      start: Math.max(i.start.getTime(), window.start.getTime()),
      end: Math.min(i.end.getTime(), window.end.getTime()),
    }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const i of clipped) {
    if (i.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = i.start;
      curEnd = i.end;
    } else if (i.end > curEnd) {
      curEnd = i.end;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.round(total / 60_000);
}

export function dayLoads(
  windows: Interval[],
  events: (Interval & { isTask: boolean; outOfOffice: boolean })[],
  dailyCapMin: number | null,
): DayLoad[] {
  return windows.map((window) => {
    const windowMin = Math.round((window.end.getTime() - window.start.getTime()) / 60_000);
    const inDay = events.filter((e) => e.start < window.end && e.end > window.start);
    return {
      day: window.start,
      capacityMin: dailyCapMin ? Math.min(dailyCapMin, windowMin) : windowMin,
      meetingMin: minutesWithin(inDay.filter((e) => !e.isTask), window),
      taskMin: minutesWithin(inDay.filter((e) => e.isTask), window),
      outOfOffice: inDay.some((e) => e.outOfOffice && e.start <= window.start && e.end >= window.end),
    };
  });
}

export type EstimateAccuracy = {
  count: number;
  estimateMin: number;
  actualMin: number;
  ratio: number | null; // actual / estimate
  biggestMisses: { id: string; title: string; estimateMin: number; actualMin: number }[];
};

/** Finished tasks that have tracked time, compared with their estimates. */
export function estimateAccuracy(
  tasks: { id: string; title: string; durationMin: number; trackedMinutes: number }[],
): EstimateAccuracy {
  const tracked = tasks.filter((t) => t.trackedMinutes > 0 && t.durationMin > 0);
  const estimateMin = tracked.reduce((s, t) => s + t.durationMin, 0);
  const actualMin = tracked.reduce((s, t) => s + t.trackedMinutes, 0);
  const biggestMisses = tracked
    .filter((t) => Math.abs(t.trackedMinutes - t.durationMin) >= 15)
    .sort((a, b) => Math.abs(b.trackedMinutes - b.durationMin) - Math.abs(a.trackedMinutes - a.durationMin))
    .slice(0, 5)
    .map((t) => ({ id: t.id, title: t.title, estimateMin: t.durationMin, actualMin: t.trackedMinutes }));
  return {
    count: tracked.length,
    estimateMin,
    actualMin,
    ratio: estimateMin > 0 ? actualMin / estimateMin : null,
    biggestMisses,
  };
}
