"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  computeRange,
  dayWeekdayLabel,
  defaultNewEventTimes,
  formatHourLabel,
  formatTime,
  formatYMD,
  HOUR_END,
  HOUR_START,
  isSameDay,
  overlapsDay,
  parseYMD,
  startOfWeekMonday,
  WEEKDAY_LABELS_MON_FIRST,
  type CalendarView,
} from "@/lib/calendar-dates";
import EventModal, { type EventModalEvent } from "./EventModal";
import QuickCreatePopup from "./QuickCreatePopup";
import { LockIcon, FlagIcon } from "../icons";
import { moveEvent, deleteEvent } from "../actions";
import { PROJECT_EVENT_COLORS, DEFAULT_EVENT_COLOR } from "@/lib/eventColors";

export type CalendarEvent = {
  id: string;
  masterId: string;
  title: string;
  start: Date;
  end: Date;
  isRecurring: boolean;
  recurrenceRule: string | null;
  locked: boolean;
  allDay: boolean;
  meetingUrl: string | null;
  // Resolved Tailwind color family (e.g. "indigo") — the event's own
  // explicit override, else its task's, else its task's project's, else
  // null for the default — see PROJECT_EVENT_COLORS below for the class
  // lookup. Despite the name, not only ever a project's color anymore.
  projectColor: string | null;
  // The linked task's priority (0=Low..3=Urgent), or null for a manual
  // event with no task. Only High/Urgent get a visible flag — see
  // EventBlock, showing every priority level would clutter a block this
  // small.
  taskPriority: number | null;
};

// PROJECT_EVENT_COLORS/DEFAULT_EVENT_COLOR now live in @/lib/eventColors
// — EventModal/TaskModal need the option list too, and importing it from
// here would be circular (this file imports EventModal to render it).

type Props = {
  view: CalendarView;
  startYMD: string;
  todayISO: string;
  events: CalendarEvent[];
};

const HOUR_HEIGHT = 48;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

type PlacedEvent = { event: CalendarEvent; col: number; cols: number };

type DraggingEvent = { id: string; masterId: string; durationMs: number };

export function layoutOverlappingEvents(events: CalendarEvent[]): PlacedEvent[] {
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
    // Track where this cluster's entries start in `result` so the cols
    // backfill below only touches its own entries — indexing by position
    // instead of `cluster.includes(r.event)` scanning the whole
    // (ever-growing) result array per cluster, which made this whole
    // function scale as roughly O(n^2) on a busy day with many clusters.
    const startIdx = result.length;
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
    for (let i = startIdx; i < result.length; i++) {
      result[i].cols = cols;
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
  | { mode: "create"; start: Date; end: Date; initialTitle?: string; initialLocked?: boolean }
  | { mode: "edit"; event: EventModalEvent }
  // Dragging/clicking empty space on the grid opens this lightweight
  // "what is this" popup first, instead of the full event editor — see
  // QuickCreatePopup. The toolbar's own "+ New event"/"+ Focus block"
  // buttons skip straight to "create" (unchanged).
  | { mode: "quick"; start: Date; end: Date };

export default function CalendarClient({
  view,
  startYMD,
  todayISO,
  events,
}: Props) {
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [draggingEvent, setDraggingEvent] = useState<DraggingEvent | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const start = useMemo(() => parseYMD(startYMD), [startYMD]);
  const today = useMemo(() => parseYMD(todayISO), [todayISO]);
  const range = useMemo(() => computeRange(view, start), [view, start]);
  // A stale selection pointing at events no longer on screen (after
  // navigating to a different date/view) would leave the "N selected"
  // bar showing with nothing visibly selected — clear it on navigation.
  useEffect(() => {
    setSelectedEventIds(new Set());
  }, [view, startYMD]);

  const openCreate = (
    s: Date,
    e: Date,
    prefill?: { title?: string; locked?: boolean },
  ) =>
    setModalState({
      mode: "create",
      start: s,
      end: e,
      initialTitle: prefill?.title,
      initialLocked: prefill?.locked,
    });
  const openQuickCreate = (s: Date, e: Date) =>
    setModalState({ mode: "quick", start: s, end: e });
  const toggleSelected = (id: string) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedEventIds(new Set());
  // "Bulk move" without reconciling a group-drag against the existing
  // single-event native HTML5 drag-and-drop (the hard, still-open half
  // of GitHub issue #3) — nudging the whole selection by a fixed amount
  // is a real, much smaller way to move several events together at once.
  // Skips locked/recurring events, same as the per-event drag already does.
  const handleBulkNudge = async (deltaMinutes: number) => {
    if (selectedEventIds.size === 0 || isBulkDeleting) return;
    const deltaMs = deltaMinutes * 60_000;
    const targets = events.filter(
      (e) => selectedEventIds.has(e.id) && !e.locked && !e.isRecurring,
    );
    try {
      await Promise.all(
        targets.map((e) =>
          moveEvent(
            e.masterId,
            new Date(e.start.getTime() + deltaMs).toISOString(),
            new Date(e.end.getTime() + deltaMs).toISOString(),
          ),
        ),
      );
    } catch (err) {
      console.error(err);
    }
  };
  const handleBulkDelete = async () => {
    if (selectedEventIds.size === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    try {
      await Promise.all([...selectedEventIds].map((id) => deleteEvent(id)));
      clearSelection();
    } catch (err) {
      console.error(err);
    } finally {
      setIsBulkDeleting(false);
    }
  };
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
        meetingUrl: event.meetingUrl,
        color: event.projectColor,
      },
    });
  };
  const closeModal = () => setModalState(null);
  const scrollToNowRef = useRef<(() => void) | null>(null);

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
        const isAlreadyToday = formatYMD(start) === formatYMD(new Date());
        if (isAlreadyToday) {
          scrollToNowRef.current?.();
        } else {
          router.push(`/?view=${view}&start=${formatYMD(new Date())}`);
        }
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
        router.push(`/?view=${nextView}&start=${target}`);
        return;
      }
      if (e.key === "j" || e.key === "ArrowLeft" || e.key === "k" || e.key === "ArrowRight") {
        const forward = e.key === "k" || e.key === "ArrowRight";
        const step = view === "day" ? 1 : view === "week" ? 7 : 0;
        const target =
          view === "month"
            ? formatYMD(addMonths(new Date(start.getFullYear(), start.getMonth(), 1), forward ? 1 : -1))
            : formatYMD(addDays(start, forward ? step : -step));
        router.push(`/?view=${view}&start=${target}`);
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
      <div className="mt-4 flex justify-end gap-2">
        {view !== "month" && (
          <button
            type="button"
            onClick={() => {
              if (formatYMD(start) === formatYMD(new Date())) {
                scrollToNowRef.current?.();
              } else {
                router.push(`/?view=${view}&start=${formatYMD(new Date())}`);
              }
            }}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Now
          </button>
        )}
        <button
          type="button"
          title="A locked block the auto-scheduler won't place tasks into"
          onClick={() => {
            const { start, end } = defaultNewEventTimes();
            openCreate(start, end, { title: "Focus time", locked: true });
          }}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          + Focus block
        </button>
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
            onEmptyClick={openQuickCreate}
            onEventClick={openEdit}
          />
        ) : (
          <>
            <div className="sm:hidden">
              <AgendaView days={range.days} events={events} today={today} onEventClick={openEdit} />
            </div>
            <div className="hidden sm:block">
              <HourGrid
                days={range.days}
                events={events}
                today={today}
                onEmptyClick={openQuickCreate}
                onEventClick={openEdit}
                draggingEvent={draggingEvent}
                onEventDragStart={handleEventDragStart}
                onEventDragEnd={handleEventDragEnd}
                scrollToNowRef={scrollToNowRef}
                selectedEventIds={selectedEventIds}
                onToggleSelect={toggleSelected}
              />
            </div>
          </>
        )}
      </div>

      {selectedEventIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2 shadow-lg ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-800">
          <span className="text-sm font-medium">
            {selectedEventIds.size} selected
          </span>
          <div className="flex items-center gap-1 border-l border-zinc-200 pl-3 dark:border-zinc-600">
            <button
              type="button"
              title="Move all selected 15 minutes earlier"
              onClick={() => handleBulkNudge(-15)}
              className="rounded-full px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              −15m
            </button>
            <button
              type="button"
              title="Move all selected 15 minutes later"
              onClick={() => handleBulkNudge(15)}
              className="rounded-full px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              +15m
            </button>
            <button
              type="button"
              title="Move all selected 1 day later"
              onClick={() => handleBulkNudge(24 * 60)}
              className="rounded-full px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              +1d
            </button>
          </div>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={isBulkDeleting}
            className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
          >
            {isBulkDeleting ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Clear
          </button>
        </div>
      )}

      {modalState?.mode === "create" && (
        <EventModal
          mode="create"
          initialStart={modalState.start}
          initialEnd={modalState.end}
          initialTitle={modalState.initialTitle}
          initialLocked={modalState.initialLocked}
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
      {modalState?.mode === "quick" && (
        <QuickCreatePopup
          start={modalState.start}
          end={modalState.end}
          onClose={closeModal}
          onCreatedEvent={(event) => setModalState({ mode: "edit", event })}
        />
      )}
    </>
  );
}

// Chronological list instead of an hour grid — grids stop being
// actionable much below 640px (there's no room for a time column plus
// multiple day columns), so phones get the list Motion/most calendar
// apps fall back to at this width instead of a cramped, scroll-heavy
// grid. Shown via `sm:hidden` alongside HourGrid's `hidden sm:block`,
// same underlying `events` prop, just a different rendering — no
// separate data fetch.
function AgendaView({
  days,
  events,
  today,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  today: Date;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const dayEvents = events
          .filter((e) => isSameDay(e.start, day))
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        return (
          <div key={day.toISOString()}>
            <p className="text-xs font-semibold text-zinc-500">
              {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              {isSameDay(day, today) && (
                <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  Today
                </span>
              )}
            </p>
            {dayEvents.length === 0 ? (
              <p className="mt-1 text-xs text-zinc-400">Nothing scheduled.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {dayEvents.map((e) => {
                  const colors = e.projectColor ? PROJECT_EVENT_COLORS[e.projectColor] : null;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onEventClick(e)}
                        className={`flex w-full items-center gap-2 rounded-lg border-l-4 px-3 py-2 text-left text-sm ${colors ? `${colors.bar} ${colors.bg} ${colors.text}` : "border-l-zinc-400 bg-zinc-50 dark:bg-zinc-700/40"}`}
                      >
                        <span className="w-14 flex-shrink-0 text-xs text-zinc-500">
                          {e.allDay
                            ? "All day"
                            : e.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                        {e.locked && <LockIcon className="h-3 w-3 flex-shrink-0 opacity-60" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
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
  scrollToNowRef,
  selectedEventIds,
  onToggleSelect,
}: {
  days: Date[];
  events: CalendarEvent[];
  today: Date;
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggingEvent: DraggingEvent | null;
  onEventDragStart: (id: string, masterId: string, durationMs: number) => void;
  onEventDragEnd: () => void;
  scrollToNowRef: React.MutableRefObject<(() => void) | null>;
  selectedEventIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  // Recomputed each render, not just on mount, same reasoning as the
  // day-column's own now-line — see the comment there.
  const now = new Date();
  const gridStyle = {
    gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
  };
  // Day view (1 column) shouldn't force the same wide min-width week view
  // (7 columns) needs — that would make single-day mobile use scroll for
  // no reason. Scale with column count instead of a single fixed value.
  const minWidthRem = Math.max(days.length * 5, 18);

  // Full 24h grid (like Motion) doesn't fit on screen at once, so the
  // hour body scrolls independently of the day header — and starts
  // scrolled to just before the current time instead of midnight.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToNow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const scrollToMinutes = Math.max(0, nowMinutes - 120);
    el.scrollTo({ top: (scrollToMinutes / 60) * HOUR_HEIGHT, behavior: "smooth" });
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const scrollToMinutes = Math.max(0, nowMinutes - 120);
    el.scrollTop = (scrollToMinutes / 60) * HOUR_HEIGHT;
  }, []);
  useEffect(() => {
    scrollToNowRef.current = scrollToNow;
    return () => {
      scrollToNowRef.current = null;
    };
  });

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${minWidthRem}rem` }}>
        <div className="flex">
          <div className="w-16 flex-shrink-0" />
          <div className="flex-1 grid" style={gridStyle}>
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className="border-b border-l border-zinc-200 px-2 py-1.5 text-center dark:border-zinc-700"
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
        {days.some((day) => events.some((e) => e.allDay && overlapsDay(e, day))) && (
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex w-16 flex-shrink-0 items-center justify-end pr-2 text-[10px] text-zinc-400">
              All day
            </div>
            <div className="flex-1 grid gap-px py-1" style={gridStyle}>
              {days.map((day) => {
                const dayAllDay = events.filter(
                  (e) => e.allDay && overlapsDay(e, day),
                );
                return (
                  <div key={day.toISOString()} className="flex flex-col gap-0.5 px-0.5">
                    {dayAllDay.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onEventClick(e)}
                        className="truncate rounded-md border-l-2 border-l-indigo-500 bg-indigo-50 px-1.5 py-0.5 text-left text-[11px] font-medium text-indigo-900 transition-colors hover:brightness-95 dark:bg-indigo-950/30 dark:text-indigo-100 dark:hover:brightness-110"
                      >
                        {e.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div
          ref={scrollRef}
          className="calendar-scroll flex max-h-[70vh] overflow-y-auto"
        >
          <div className="relative w-16 flex-shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="pr-2 text-right text-xs text-zinc-500"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {formatHourLabel(h)}
              </div>
            ))}
            {days.some((day) => isSameDay(day, today)) && (
              <div
                className="pointer-events-none absolute right-2 z-10 -translate-y-1/2 text-[10px] font-semibold text-red-500"
                style={{
                  top: `${((now.getHours() * 60 + now.getMinutes() - HOUR_START * 60) / 60) * HOUR_HEIGHT}px`,
                }}
              >
                {formatTime(now)}
              </div>
            )}
          </div>
          <div className="flex-1 grid" style={gridStyle}>
            {days.map((day) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                isToday={isSameDay(day, today)}
                events={events}
                onEmptyClick={onEmptyClick}
                onEventClick={onEventClick}
                draggingEvent={draggingEvent}
                onEventDragStart={onEventDragStart}
                onEventDragEnd={onEventDragEnd}
                selectedEventIds={selectedEventIds}
                onToggleSelect={onToggleSelect}
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
  isToday,
  events,
  onEmptyClick,
  onEventClick,
  draggingEvent,
  onEventDragStart,
  onEventDragEnd,
  selectedEventIds,
  onToggleSelect,
}: {
  day: Date;
  isToday: boolean;
  events: CalendarEvent[];
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggingEvent: DraggingEvent | null;
  onEventDragStart: (id: string, masterId: string, durationMs: number) => void;
  onEventDragEnd: () => void;
  selectedEventIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  // Recomputed each render (not just on mount) so the line keeps pace
  // while the tab stays open, same as the header's today highlight.
  const nowTop = isToday
    ? ((new Date().getHours() * 60 + new Date().getMinutes() - HOUR_START * 60) / 60) *
      HOUR_HEIGHT
    : null;
  const dayEvents = useMemo(
    () => events.filter((e) => !e.allDay && isSameDay(e.start, day)),
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
      className={
        isToday
          ? "relative border-l border-zinc-200 bg-indigo-50/40 dark:border-zinc-700 dark:bg-indigo-500/[0.06]"
          : "relative border-l border-zinc-200 dark:border-zinc-700"
      }
      style={{ height: `${TOTAL_HEIGHT}px` }}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute left-0 right-0 border-t border-zinc-200 dark:border-zinc-700"
          style={{
            top: `${(h - HOUR_START) * HOUR_HEIGHT}px`,
            height: `${HOUR_HEIGHT}px`,
          }}
        />
      ))}
      {nowTop !== null && (
        // The current-time label lives in the gutter on the left
        // (HourGrid) now — this is just the line across the day itself.
        <div
          className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-red-500"
          style={{ top: `${nowTop}px` }}
        />
      )}
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
            selected={selectedEventIds.has(event.id)}
            onToggleSelect={onToggleSelect}
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
  selected,
  onToggleSelect,
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
  selected: boolean;
  onToggleSelect: (id: string) => void;
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
  const color = event.projectColor
    ? (PROJECT_EVENT_COLORS[event.projectColor] ?? DEFAULT_EVENT_COLOR)
    : DEFAULT_EVENT_COLOR;

  return (
    <button
      data-event
      // Locked only means "the scheduler won't auto-move this" — it
      // doesn't stop the user from dragging it themselves. Recurring
      // events still can't be dragged at all (unrelated limitation:
      // there's no per-occurrence override, only the whole series).
      draggable={!event.isRecurring}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        e.stopPropagation();
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          onToggleSelect(event.id);
          return;
        }
        onClick(event);
      }}
      type="button"
      title="Shift/Cmd/Ctrl-click to select multiple events"
      className={`group absolute overflow-hidden rounded-lg border-y border-r border-zinc-200 border-l-4 bg-white p-1.5 text-left text-zinc-900 shadow-sm transition-all hover:shadow-md hover:brightness-95 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:brightness-110 ${color.bar} ${
        isDragging ? "opacity-40" : ""
      } ${selected ? "ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-zinc-900" : ""}`}
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
          className="absolute right-1 top-1 opacity-70"
        >
          <LockIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {event.taskPriority !== null && event.taskPriority >= 2 && (
        <span
          aria-label={event.taskPriority === 3 ? "Urgent priority" : "High priority"}
          title={event.taskPriority === 3 ? "Urgent priority task" : "High priority task"}
          className={
            event.taskPriority === 3
              ? "absolute left-1 top-1 text-red-600 dark:text-red-400"
              : "absolute left-1 top-1 text-amber-600 dark:text-amber-400"
          }
        >
          <FlagIcon className="h-2.5 w-2.5" />
        </span>
      )}
      <div
        className={`truncate pr-3 text-xs font-medium ${
          event.taskPriority !== null && event.taskPriority >= 2 ? "pl-3" : ""
        }`}
      >
        {event.title}
      </div>
      {displayHeight >= 32 && (
        <div className="truncate text-[10px] opacity-80">
          {formatTime(event.start)} – {formatTime(displayEnd)}
        </div>
      )}
      {!event.isRecurring && (
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
  // Overlap-based, not an exact formatYMD(event.start) match — otherwise a
  // multi-day event (a synced all-day trip, say) only ever shows on its
  // first day and silently vanishes for the rest of its span.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days) {
      map.set(
        formatYMD(day),
        events.filter((ev) => overlapsDay(ev, day)),
      );
    }
    return map;
  }, [events, days]);

  const currentMonth = viewStart.getMonth();

  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-700">
      {WEEKDAY_LABELS_MON_FIRST.map((label) => (
        <div
          key={label}
          className="bg-white px-2 py-1.5 text-center text-xs font-medium text-zinc-500 dark:bg-zinc-800"
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
      ? "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
      : "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-zinc-400";

  return (
    <div
      onClick={handleClick}
      className="flex min-h-[7rem] cursor-pointer flex-col gap-1 bg-white p-1.5 transition-colors hover:bg-zinc-50 dark:bg-zinc-800 dark:hover:bg-zinc-700/50"
    >
      <Link
        data-day-link
        href={`/?view=day&start=${dateYMD}`}
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
                className="ml-1 inline-block opacity-70"
              >
                <LockIcon className="inline h-2.5 w-2.5" />
              </span>
            )}
          </button>
        ))}
        {more > 0 && (
          <Link
            data-day-link
            href={`/?view=day&start=${dateYMD}`}
            className="px-1.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            +{more} more
          </Link>
        )}
      </div>
    </div>
  );
}
