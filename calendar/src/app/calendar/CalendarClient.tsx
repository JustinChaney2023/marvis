"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  computeRange,
  dayWeekdayLabel,
  defaultNewEventTimes,
  formatHourLabel,
  formatTime,
  formatYMD,
  isSameDay,
  parseYMD,
  startOfWeekMonday,
  WEEKDAY_LABELS_MON_FIRST,
  type CalendarView,
} from "@/lib/calendar-dates";
import EventModal, { type EventModalEvent } from "./EventModal";
import { moveEvent } from "../actions";

export type CalendarEvent = {
  id: string;
  masterId: string;
  title: string;
  start: Date;
  end: Date;
  isRecurring: boolean;
  recurrenceRule: string | null;
  locked: boolean;
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

type DraggingEvent = { id: string; masterId: string; durationMs: number };

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

function yToMinutesFromColumnTop(y: number): number {
  return (y / HOUR_HEIGHT) * 60;
}

function snapMinutesToStart(day: Date, minutesFromTop: number): Date | null {
  const snapped = Math.round(minutesFromTop / 30) * 30;
  const startHour = HOUR_START + Math.floor(snapped / 60);
  const startMin = snapped % 60;
  if (startHour >= HOUR_END) return null;
  const start = new Date(day);
  start.setHours(startHour, startMin, 0, 0);
  return start;
}

const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;

function clampMinutes(m: number): number {
  return Math.min(Math.max(m, 0), TOTAL_MINUTES);
}

function snapTo30(m: number): number {
  return Math.round(m / 30) * 30;
}

// Unlike snapMinutesToStart, this allows minutes === TOTAL_MINUTES (i.e. the
// grid's bottom edge, HOUR_END) — needed for the END of a drag-created
// range, which can legitimately land exactly at close-of-grid.
function minutesToDate(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(HOUR_START, 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
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
  const [draggingEvent, setDraggingEvent] = useState<DraggingEvent | null>(null);
  const start = useMemo(() => parseYMD(startYMD), [startYMD]);
  const today = useMemo(() => parseYMD(todayISO), [todayISO]);
  const range = useMemo(() => computeRange(view, start), [view, start]);

  const openCreate = (s: Date, e: Date) =>
    setModalState({ mode: "create", start: s, end: e });
  const openEdit = (event: CalendarEvent) => {
    setModalState({
      mode: "edit",
      event: {
        id: event.masterId,
        title: event.title,
        start: event.start,
        end: event.end,
        recurrenceRule: event.recurrenceRule,
        locked: event.locked,
      },
    });
  };
  const closeModal = () => setModalState(null);

  const router = useRouter();
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (modalState || isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return;

      if (e.key === "t") {
        router.push(`/calendar?view=${view}&start=${formatYMD(new Date())}`);
        return;
      }
      if (e.key === "d" || e.key === "w" || e.key === "m") {
        const nextView: CalendarView =
          e.key === "d" ? "day" : e.key === "w" ? "week" : "month";
        const target =
          nextView === "day"
            ? formatYMD(start)
            : nextView === "week"
              ? formatYMD(startOfWeekMonday(start))
              : formatYMD(new Date(start.getFullYear(), start.getMonth(), 1));
        router.push(`/calendar?view=${nextView}&start=${target}`);
        return;
      }
      if (e.key === "j" || e.key === "ArrowLeft" || e.key === "k" || e.key === "ArrowRight") {
        const forward = e.key === "k" || e.key === "ArrowRight";
        const step = view === "day" ? 1 : view === "week" ? 7 : 0;
        const target =
          view === "month"
            ? formatYMD(addMonths(new Date(start.getFullYear(), start.getMonth(), 1), forward ? 1 : -1))
            : formatYMD(addDays(start, forward ? step : -step));
        router.push(`/calendar?view=${view}&start=${target}`);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, start, modalState, router]);

  const handleEventDragStart = (
    id: string,
    masterId: string,
    durationMs: number,
  ) => {
    setDraggingEvent({ id, masterId, durationMs });
  };
  const handleEventDragEnd = () => {
    setDraggingEvent(null);
  };

  return (
    <>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            const { start, end } = defaultNewEventTimes();
            openCreate(start, end);
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
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
            draggingEvent={draggingEvent}
            onEventDragStart={handleEventDragStart}
            onEventDragEnd={handleEventDragEnd}
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
  draggingEvent,
  onEventDragStart,
  onEventDragEnd,
}: {
  days: Date[];
  events: CalendarEvent[];
  today: Date;
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggingEvent: DraggingEvent | null;
  onEventDragStart: (id: string, masterId: string, durationMs: number) => void;
  onEventDragEnd: () => void;
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
                  className="border-b border-l border-zinc-200 px-2 py-1.5 text-center dark:border-zinc-800"
                >
                  <div className="text-xs font-medium text-zinc-500">
                    {dayWeekdayLabel(day)}
                  </div>
                  <div
                    className={
                      isToday
                        ? "mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white shadow-sm"
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
                draggingEvent={draggingEvent}
                onEventDragStart={onEventDragStart}
                onEventDragEnd={onEventDragEnd}
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
  draggingEvent,
  onEventDragStart,
  onEventDragEnd,
}: {
  day: Date;
  events: CalendarEvent[];
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggingEvent: DraggingEvent | null;
  onEventDragStart: (id: string, masterId: string, durationMs: number) => void;
  onEventDragEnd: () => void;
}) {
  const dayEvents = useMemo(
    () => events.filter((e) => isSameDay(e.start, day)),
    [events, day],
  );
  const layout = useMemo(() => layoutOverlappingEvents(dayEvents), [dayEvents]);

  const [createPreview, setCreatePreview] = useState<
    { lo: number; hi: number } | null
  >(null);

  // A plain click and a drag both start as mousedown on empty space; we
  // only know which one it was once the mouse comes back up. A drag of at
  // least half an hour opens the modal with that exact range; anything
  // shorter (including a simple click, which never moves) falls back to
  // the old fixed 30-minute default at the clicked time.
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (draggingEvent) return;
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorMinutes = clampMinutes(
      yToMinutesFromColumnTop(e.clientY - rect.top),
    );
    let moved = false;
    setCreatePreview({ lo: anchorMinutes, hi: anchorMinutes });

    const onMove = (ev: MouseEvent) => {
      const minutes = clampMinutes(
        yToMinutesFromColumnTop(ev.clientY - rect.top),
      );
      if (minutes !== anchorMinutes) moved = true;
      setCreatePreview({
        lo: Math.min(anchorMinutes, minutes),
        hi: Math.max(anchorMinutes, minutes),
      });
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setCreatePreview(null);

      const releaseMinutes = clampMinutes(
        yToMinutesFromColumnTop(ev.clientY - rect.top),
      );
      const loSnapped = snapTo30(Math.min(anchorMinutes, releaseMinutes));
      const hiSnapped = snapTo30(Math.max(anchorMinutes, releaseMinutes));
      const start = minutesToDate(day, loSnapped);
      const draggedEnough = moved && hiSnapped - loSnapped >= 30;
      const end = draggedEnough
        ? minutesToDate(day, hiSnapped)
        : new Date(start.getTime() + 30 * 60_000);
      onEmptyClick(start, end);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (draggingEvent) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const active = draggingEvent;
    onEventDragEnd();
    if (!active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutesFromTop = yToMinutesFromColumnTop(e.clientY - rect.top);
    const start = snapMinutesToStart(day, minutesFromTop);
    if (!start) return;
    const end = new Date(start.getTime() + active.durationMs);
    try {
      await moveEvent(
        active.masterId,
        start.toISOString(),
        end.toISOString(),
      );
    } catch (err) {
      console.error(err);
    }
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
      <div
        className="absolute inset-0"
        onMouseDown={handleMouseDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />
      {createPreview && (
        <div
          className="pointer-events-none absolute left-0 right-0 rounded-lg border-2 border-dashed border-indigo-500 bg-indigo-500/10"
          style={{
            top: `${(createPreview.lo / 60) * HOUR_HEIGHT}px`,
            height: `${Math.max(
              ((createPreview.hi - createPreview.lo) / 60) * HOUR_HEIGHT,
              4,
            )}px`,
          }}
        />
      )}
      {layout.map(({ event, col, cols }) => {
        const block = computeBlock(event.start, event.end);
        if (!block) return null;
        return (
          <EventBlock
            key={event.id}
            event={event}
            top={block.top}
            height={block.height}
            left={`${(col / cols) * 100}%`}
            width={`${(1 / cols) * 100}%`}
            isDragging={draggingEvent?.id === event.id}
            onMoveStart={onEventDragStart}
            onMoveEnd={onEventDragEnd}
            onClick={onEventClick}
          />
        );
      })}
    </div>
  );
}

function EventBlock({
  event,
  top,
  height,
  left,
  width,
  isDragging,
  onMoveStart,
  onMoveEnd,
  onClick,
}: {
  event: CalendarEvent;
  top: number;
  height: number;
  left: string;
  width: string;
  isDragging: boolean;
  onMoveStart: (id: string, masterId: string, durationMs: number) => void;
  onMoveEnd: () => void;
  onClick: (event: CalendarEvent) => void;
}) {
  const [previewEnd, setPreviewEnd] = useState<Date | null>(null);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData("text/plain", event.id);
    e.dataTransfer.effectAllowed = "move";
    onMoveStart(
      event.id,
      event.masterId,
      event.end.getTime() - event.start.getTime(),
    );
  };

  const handleDragEnd = () => {
    onMoveEnd();
  };

  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const originalEnd = event.end.getTime();
    const originalStart = event.start.getTime();
    const minEnd = originalStart + 15 * 60 * 1000;
    let latestEndMs = originalEnd;

    const onMove = (ev: MouseEvent) => {
      const deltaY = ev.clientY - startY;
      const deltaMinutes = yToMinutesFromColumnTop(deltaY);
      let newEndMs = originalEnd + deltaMinutes * 60 * 1000;
      newEndMs = Math.round(newEndMs / (15 * 60 * 1000)) * (15 * 60 * 1000);
      if (newEndMs < minEnd) newEndMs = minEnd;
      latestEndMs = newEndMs;
      const newMinutes = (newEndMs - originalStart) / 60000;
      const newHeight = (newMinutes / 60) * HOUR_HEIGHT;
      setPreviewEnd(new Date(newEndMs));
      setPreviewHeight(newHeight);
    };

    const onUp = async () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (latestEndMs !== originalEnd) {
        try {
          await moveEvent(
            event.masterId,
            new Date(originalStart).toISOString(),
            new Date(latestEndMs).toISOString(),
          );
        } catch (err) {
          console.error(err);
        }
      }
      setPreviewEnd(null);
      setPreviewHeight(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const displayHeight = previewHeight ?? height;
  const displayEnd = previewEnd ?? event.end;

  return (
    <button
      data-event
      draggable={!event.isRecurring && !event.locked}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      type="button"
      className={`group absolute overflow-hidden rounded-lg border-y border-r border-zinc-200/40 border-l-2 border-l-indigo-500 bg-indigo-50 p-1.5 text-left text-indigo-900 shadow-sm transition-all hover:shadow-md hover:brightness-95 dark:border-zinc-700/60 dark:bg-indigo-950/30 dark:text-indigo-100 dark:hover:brightness-110 ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{
        top: `${top}px`,
        height: `${displayHeight}px`,
        left,
        width,
      }}
    >
      {event.locked && (
        <span
          aria-label="Locked"
          title="Locked — won't be moved by auto-scheduling or drag"
          className="absolute right-1 top-1 text-[10px] opacity-70"
        >
          🔒
        </span>
      )}
      <div className="truncate pr-3 text-xs font-medium">{event.title}</div>
      {displayHeight >= 32 && (
        <div className="truncate text-[10px] opacity-80">
          {formatTime(event.start)} – {formatTime(displayEnd)}
        </div>
      )}
      {!event.isRecurring && !event.locked && (
        <div
          draggable={false}
          onMouseDown={handleResizeMouseDown}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-indigo-400/80 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-indigo-500/80"
          aria-label="Resize event"
        />
      )}
    </button>
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
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-800">
      {WEEKDAY_LABELS_MON_FIRST.map((label) => (
        <div
          key={label}
          className="bg-white px-2 py-1.5 text-center text-xs font-medium text-zinc-500 dark:bg-zinc-900"
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
    ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white shadow-sm"
    : inCurrentMonth
      ? "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
      : "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-zinc-400";

  return (
    <div
      onClick={handleClick}
      className="flex min-h-[7rem] cursor-pointer flex-col gap-1 bg-white p-1.5 transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
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
            className="truncate rounded-md border-l-2 border-l-indigo-500 bg-indigo-50 px-1.5 py-0.5 text-left text-[11px] text-indigo-900 transition-colors hover:brightness-95 dark:bg-indigo-950/30 dark:text-indigo-100 dark:hover:brightness-110"
          >
            {ev.title}
            {ev.locked && (
              <span
                aria-label="Locked"
                title="Locked"
                className="ml-1 text-[10px] opacity-70"
              >
                🔒
              </span>
            )}
          </button>
        ))}
        {more > 0 && (
          <Link
            data-day-link
            href={`/calendar?view=day&start=${dateYMD}`}
            className="px-1.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            +{more} more
          </Link>
        )}
      </div>
    </div>
  );
}
