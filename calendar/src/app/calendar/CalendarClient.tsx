"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  computeRange,
  dayWeekdayLabel,
  defaultNewEventTimes,
  formatHourLabel,
  formatTime,
  formatYMD,
  isSameDay,
  parseYMD,
  WEEKDAY_LABELS_MON_FIRST,
  type CalendarView,
} from "@/lib/calendar-dates";
import EventModal, { type EventModalEvent } from "./EventModal";

export type CalendarEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
};

type Props = {
  view: CalendarView;
  startYMD: string;
  todayISO: string;
  events: CalendarEvent[];
};

const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_HEIGHT = 48;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

type PlacedEvent = { event: CalendarEvent; col: number; cols: number };

function layoutOverlappingEvents(events: CalendarEvent[]): PlacedEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const clusters: CalendarEvent[][] = [];
  let current: CalendarEvent[] = [];
  let clusterEnd = -Infinity;
  for (const ev of sorted) {
    if (ev.start.getTime() >= clusterEnd) {
      if (current.length) clusters.push(current);
      current = [ev];
      clusterEnd = ev.end.getTime();
    } else {
      current.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.end.getTime());
    }
  }
  if (current.length) clusters.push(current);

  const result: PlacedEvent[] = [];
  for (const cluster of clusters) {
    const columns: CalendarEvent[][] = [];
    for (const ev of cluster) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        const lastInCol = columns[i][columns[i].length - 1];
        if (lastInCol.end.getTime() <= ev.start.getTime()) {
          columns[i].push(ev);
          result.push({ event: ev, col: i, cols: 0 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([ev]);
        result.push({ event: ev, col: columns.length - 1, cols: 0 });
      }
    }
    const cols = columns.length;
    for (const r of result) {
      if (cluster.includes(r.event)) {
        r.cols = cols;
      }
    }
  }
  return result;
}

function computeBlock(
  start: Date,
  end: Date,
): { top: number; height: number } | null {
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const windowStart = new Date(dayStart);
  windowStart.setHours(HOUR_START, 0, 0, 0);
  const windowEnd = new Date(dayStart);
  windowEnd.setHours(HOUR_END, 0, 0, 0);

  const vs = Math.max(start.getTime(), windowStart.getTime());
  const ve = Math.min(end.getTime(), windowEnd.getTime());
  if (ve <= vs) return null;

  const offsetMinutes = (vs - windowStart.getTime()) / 60000;
  const durationMinutes = (ve - vs) / 60000;

  return {
    top: (offsetMinutes / 60) * HOUR_HEIGHT,
    height: (durationMinutes / 60) * HOUR_HEIGHT,
  };
}

type ModalState =
  | { mode: "create"; start: Date; end: Date }
  | { mode: "edit"; event: EventModalEvent };

export default function CalendarClient({
  view,
  startYMD,
  todayISO,
  events,
}: Props) {
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const start = useMemo(() => parseYMD(startYMD), [startYMD]);
  const today = useMemo(() => parseYMD(todayISO), [todayISO]);
  const range = useMemo(() => computeRange(view, start), [view, start]);

  const openCreate = (s: Date, e: Date) =>
    setModalState({ mode: "create", start: s, end: e });
  const openEdit = (event: CalendarEvent) => {
    setModalState({
      mode: "edit",
      event: {
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
      },
    });
  };
  const closeModal = () => setModalState(null);

  return (
    <>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            const { start, end } = defaultNewEventTimes();
            openCreate(start, end);
          }}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          + New event
        </button>
      </div>

      <div className="mt-6">
        {view === "month" ? (
          <MonthView
            days={range.days}
            events={events}
            today={today}
            viewStart={start}
            onEmptyClick={openCreate}
            onEventClick={openEdit}
          />
        ) : (
          <HourGrid
            days={range.days}
            events={events}
            today={today}
            onEmptyClick={openCreate}
            onEventClick={openEdit}
          />
        )}
      </div>

      {modalState?.mode === "create" && (
        <EventModal
          mode="create"
          initialStart={modalState.start}
          initialEnd={modalState.end}
          event={null}
          onClose={closeModal}
        />
      )}
      {modalState?.mode === "edit" && (
        <EventModal
          mode="edit"
          initialStart={modalState.event.start}
          initialEnd={modalState.event.end}
          event={modalState.event}
          onClose={closeModal}
        />
      )}
    </>
  );
}

function HourGrid({
  days,
  events,
  today,
  onEmptyClick,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  today: Date;
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const gridStyle = {
    gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
  };
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[40rem]">
        <div className="flex">
          <div className="w-16 flex-shrink-0" />
          <div className="flex-1 grid" style={gridStyle}>
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className="border-b border-l border-zinc-200 px-2 py-1 text-center dark:border-zinc-800"
                >
                  <div className="text-xs font-medium text-zinc-500">
                    {dayWeekdayLabel(day)}
                  </div>
                  <div
                    className={
                      isToday
                        ? "text-lg font-bold text-zinc-900 dark:text-zinc-50"
                        : "text-lg font-semibold text-zinc-700 dark:text-zinc-300"
                    }
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex">
          <div className="w-16 flex-shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="pr-2 text-right text-xs text-zinc-500"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {formatHourLabel(h)}
              </div>
            ))}
          </div>
          <div className="flex-1 grid" style={gridStyle}>
            {days.map((day) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                events={events}
                onEmptyClick={onEmptyClick}
                onEventClick={onEventClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  onEmptyClick,
  onEventClick,
}: {
  day: Date;
  events: CalendarEvent[];
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const dayEvents = useMemo(
    () => events.filter((e) => isSameDay(e.start, day)),
    [events, day],
  );
  const layout = useMemo(() => layoutOverlappingEvents(dayEvents), [dayEvents]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutesFromTop = (y / HOUR_HEIGHT) * 60;
    const snapped = Math.round(minutesFromTop / 30) * 30;
    const startHour = HOUR_START + Math.floor(snapped / 60);
    const startMin = snapped % 60;
    if (startHour >= HOUR_END) return;

    const start = new Date(day);
    start.setHours(startHour, startMin, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 30);
    onEmptyClick(start, end);
  };

  return (
    <div
      className="relative border-l border-zinc-200 dark:border-zinc-800"
      style={{ height: `${TOTAL_HEIGHT}px` }}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute left-0 right-0 border-t border-zinc-200 dark:border-zinc-800"
          style={{
            top: `${(h - HOUR_START) * HOUR_HEIGHT}px`,
            height: `${HOUR_HEIGHT}px`,
          }}
        />
      ))}
      <div className="absolute inset-0" onClick={handleClick} />
      {layout.map(({ event, col, cols }) => {
        const block = computeBlock(event.start, event.end);
        if (!block) return null;
        return (
          <button
            data-event
            key={event.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEventClick(event);
            }}
            className="absolute overflow-hidden rounded border border-blue-300 bg-blue-100 p-1 text-left text-blue-900 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-100"
            style={{
              top: `${block.top}px`,
              height: `${block.height}px`,
              left: `${(col / cols) * 100}%`,
              width: `${(1 / cols) * 100}%`,
            }}
          >
            <div className="truncate text-xs font-medium">{event.title}</div>
            {block.height >= 32 && (
              <div className="truncate text-[10px] opacity-80">
                {formatTime(event.start)} – {formatTime(event.end)}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MonthView({
  days,
  events,
  today,
  viewStart,
  onEmptyClick,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  today: Date;
  viewStart: Date;
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = formatYMD(ev.start);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const currentMonth = viewStart.getMonth();

  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
      {WEEKDAY_LABELS_MON_FIRST.map((label) => (
        <div
          key={label}
          className="bg-white px-2 py-1 text-center text-xs font-medium text-zinc-500 dark:bg-zinc-900"
        >
          {label}
        </div>
      ))}
      {days.map((day) => (
        <MonthCell
          key={day.toISOString()}
          day={day}
          events={eventsByDay.get(formatYMD(day)) ?? []}
          today={today}
          inCurrentMonth={day.getMonth() === currentMonth}
          onEmptyClick={onEmptyClick}
          onEventClick={onEventClick}
        />
      ))}
    </div>
  );
}

function MonthCell({
  day,
  events,
  today,
  inCurrentMonth,
  onEmptyClick,
  onEventClick,
}: {
  day: Date;
  events: CalendarEvent[];
  today: Date;
  inCurrentMonth: boolean;
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const dateYMD = formatYMD(day);
  const isToday = isSameDay(day, today);
  const visible = events.slice(0, 3);
  const more = events.length - visible.length;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-event]") || t.closest("[data-day-link]")) return;
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    const end = new Date(day);
    end.setHours(9, 30, 0, 0);
    onEmptyClick(start, end);
  };

  const dayNumberClass = isToday
    ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white"
    : inCurrentMonth
      ? "text-xs font-semibold text-zinc-900 dark:text-zinc-100"
      : "text-xs font-semibold text-zinc-400";

  return (
    <div
      onClick={handleClick}
      className="flex min-h-[7rem] cursor-pointer flex-col gap-1 bg-white p-1 dark:bg-zinc-900"
    >
      <Link
        data-day-link
        href={`/calendar?view=day&start=${dateYMD}`}
        className={dayNumberClass}
      >
        {day.getDate()}
      </Link>
      <div className="flex flex-col gap-0.5">
        {visible.map((ev) => (
          <button
            data-event
            key={ev.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEventClick(ev);
            }}
            className="truncate rounded bg-blue-100 px-1.5 py-0.5 text-left text-[11px] text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:hover:bg-blue-900/60"
          >
            {ev.title}
          </button>
        ))}
        {more > 0 && (
          <Link
            data-day-link
            href={`/calendar?view=day&start=${dateYMD}`}
            className="px-1.5 text-[11px] text-zinc-500 hover:underline"
          >
            +{more} more
          </Link>
        )}
      </div>
    </div>
  );
}
