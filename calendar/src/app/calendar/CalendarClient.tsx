"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  computeRange,
  dayWeekdayLabel,
  defaultNewEventTimes,
  formatHourLabel,
  formatHourLabelInZone,
  formatTime,
  formatYMD,
  HOUR_END,
  HOUR_START,
  isSameDay,
  overlapsDay,
  parseYMD,
  startOfDay,
  startOfWeek,
  WEEKDAY_LABELS_SUN_FIRST,
  type CalendarView,
} from "@/lib/calendar-dates";
import EventModal, { type EventModalEvent, type GoogleAccountOption } from "./EventModal";
import { useNowContext } from "./NowContext";
import QuickCreatePopup from "./QuickCreatePopup";
import { LockIcon, FlagIcon } from "../icons";
import { moveEvent, deleteEvent } from "../actions";
import { PROJECT_EVENT_COLORS, DEFAULT_EVENT_COLOR } from "@/lib/eventColors";
import Button from "../ui/Button";

export type CalendarEvent = {
  id: string;
  masterId: string;
  title: string;
  notes: string | null;
  location: string | null;
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
  // Out-of-office/focus-time as distinct event types (#36) — mostly a
  // display distinction (EventBlock renders a small badge for either).
  eventType: "DEFAULT" | "OUT_OF_OFFICE" | "FOCUS_TIME";
  reminderMinutes: number | null;
  googleAccountId: string | null;
};

// PROJECT_EVENT_COLORS/DEFAULT_EVENT_COLOR now live in @/lib/eventColors
// — EventModal/TaskModal need the option list too, and importing it from
// here would be circular (this file imports EventModal to render it).

// A read-only event from a calendar someone else shared with you (see
// CalendarShare in schema.prisma) — deliberately a much smaller shape
// than CalendarEvent: no id-for-editing, no color/priority/lock, since
// none of that ever renders interactively. `title` is already "Busy"
// server-side for a BUSY_ONLY share — this component never sees the
// real title in that case, not just hides it.
export type SharedEvent = {
  id: string;
  start: Date;
  end: Date;
  allDay: boolean;
  title: string;
  ownerLabel: string;
};

type Props = {
  view: CalendarView;
  startYMD: string;
  todayISO: string;
  events: CalendarEvent[];
  sharedEvents?: SharedEvent[];
  secondaryTimezone?: string | null;
  googleAccounts?: GoogleAccountOption[];
};

const HOUR_HEIGHT = 48;
const ALL_DAY_ROW_HEIGHT = 22;
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

export type AllDayPlacement = { event: CalendarEvent; col: number; span: number; track: number };

/**
 * A multi-day all-day event used to render as a separate, identical pill
 * repeated in each day cell it touched — disconnected fragments instead
 * of the one continuous bar Google Calendar (and most calendar UIs)
 * draw across the days it actually spans. This computes that: which
 * column it starts in and how many columns wide it is (clamped to the
 * visible `days` window on either end), plus a vertical `track` so two
 * overlapping multi-day events stack instead of colliding — same
 * interval-packing idea as layoutOverlappingEvents above, just packing
 * into horizontal tracks instead of columns.
 */
export function layoutAllDayEvents(events: CalendarEvent[], days: Date[]): AllDayPlacement[] {
  if (days.length === 0) return [];
  const rangeStart = startOfDay(days[0]).getTime();
  const relevant = events
    .filter((e) => e.allDay && days.some((day) => overlapsDay(e, day)))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const trackEndCol: number[] = []; // exclusive end column currently occupied per track
  const placements: AllDayPlacement[] = [];
  for (const event of relevant) {
    const startCol = Math.max(0, Math.floor((startOfDay(event.start).getTime() - rangeStart) / 86_400_000));
    const endColExclusive = Math.min(days.length, Math.ceil((event.end.getTime() - rangeStart) / 86_400_000));
    const span = Math.max(1, endColExclusive - startCol);

    let track = trackEndCol.findIndex((end) => end <= startCol);
    if (track === -1) {
      track = trackEndCol.length;
      trackEndCol.push(startCol + span);
    } else {
      trackEndCol[track] = startCol + span;
    }
    placements.push({ event, col: startCol, span, track });
  }
  return placements;
}

function computeNowTop(now: Date): number {
  return ((now.getHours() * 60 + now.getMinutes() - HOUR_START * 60) / 60) * HOUR_HEIGHT;
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
  | {
      mode: "create";
      start: Date;
      end: Date;
      initialTitle?: string;
      initialLocked?: boolean;
      initialEventType?: CalendarEvent["eventType"];
    }
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
  sharedEvents = [],
  secondaryTimezone = null,
  googleAccounts = [],
}: Props) {
  // "Upcoming" (right sidebar) links to a plain event as
  // `/?view=day&start=...&edit=<eventId>` — open its editor immediately
  // if that event is already in `events` (the day it was jumped to),
  // computed as the initial state rather than set from an effect so it
  // doesn't cost an extra render.
  const searchParams = useSearchParams();
  const [modalState, setModalState] = useState<ModalState | null>(() => {
    const editEventId = searchParams.get("edit");
    const match = editEventId ? events.find((e) => e.masterId === editEventId) : null;
    if (!match) return null;
    return {
      mode: "edit",
      event: {
        id: match.masterId,
        title: match.title,
        notes: match.notes,
        location: match.location,
        start: match.start,
        end: match.end,
        recurrenceRule: match.recurrenceRule,
        locked: match.locked,
        meetingUrl: match.meetingUrl,
        color: match.projectColor,
        eventType: match.eventType,
        allDay: match.allDay,
        reminderMinutes: match.reminderMinutes,
        googleAccountId: match.googleAccountId,
      },
    };
  });
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
    prefill?: { title?: string; locked?: boolean; eventType?: CalendarEvent["eventType"] },
  ) =>
    setModalState({
      mode: "create",
      start: s,
      end: e,
      initialTitle: prefill?.title,
      initialLocked: prefill?.locked,
      initialEventType: prefill?.eventType,
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
      // Same recurring-event exclusion as handleBulkNudge — a recurring
      // occurrence's `id` (masterId::ISO) never matches a real Event row,
      // so passing it to deleteEvent silently no-ops. Bulk delete has no
      // per-occurrence-vs-series prompt the way the single-event modal
      // does, so recurring events in the selection are just skipped
      // rather than guessing which scope the user meant.
      const targets = events.filter((e) => selectedEventIds.has(e.id) && !e.isRecurring);
      await Promise.all(targets.map((e) => deleteEvent(e.masterId)));
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
        notes: event.notes,
        location: event.location,
        start: event.start,
        end: event.end,
        recurrenceRule: event.recurrenceRule,
        locked: event.locked,
        meetingUrl: event.meetingUrl,
        color: event.projectColor,
        eventType: event.eventType,
        allDay: event.allDay,
        reminderMinutes: event.reminderMinutes,
        googleAccountId: event.googleAccountId,
      },
    });
  };
  const closeModal = () => setModalState(null);
  const scrollToNowRef = useRef<(() => void) | null>(null);

  // The "Now" button itself lives in the left sidebar now — register the
  // scroll behavior so it can still trigger it (see NowContext.tsx).
  const { register: registerNowScroll } = useNowContext();
  useEffect(() => {
    registerNowScroll(() => scrollToNowRef.current?.());
    return () => registerNowScroll(null);
  }, [registerNowScroll]);

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
              ? formatYMD(startOfWeek(start))
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 justify-end gap-2 print:hidden">
        <Button
          type="button"
          variant="secondary"
          title="A locked block the auto-scheduler won't place tasks into"
          onClick={() => {
            const { start, end } = defaultNewEventTimes();
            openCreate(start, end, { title: "Focus time", locked: true, eventType: "FOCUS_TIME" });
          }}
        >
          + Focus block
        </Button>
        <Button
          type="button"
          variant="secondary"
          title="Blocks the day off and marks it distinctly on the calendar"
          onClick={() => {
            const start = new Date(today);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            openCreate(start, end, { title: "Out of office", locked: true, eventType: "OUT_OF_OFFICE" });
          }}
        >
          + Out of office
        </Button>
        <Button
          type="button"
          onClick={() => {
            const { start, end } = defaultNewEventTimes();
            openCreate(start, end);
          }}
        >
          + New event
        </Button>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        {view === "month" ? (
          <MonthView
            days={range.days}
            events={events}
            sharedEvents={sharedEvents}
            today={today}
            viewStart={start}
            onEmptyClick={openQuickCreate}
            onEventClick={openEdit}
          />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto sm:hidden">
              <AgendaView days={range.days} events={events} today={today} onEventClick={openEdit} />
            </div>
            <div className="hidden min-h-0 flex-1 sm:flex sm:flex-col">
              <HourGrid
                days={range.days}
                events={events}
                sharedEvents={sharedEvents}
                today={today}
                secondaryTimezone={secondaryTimezone}
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
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-rule bg-surface px-4 py-2">
          <span className="text-sm font-medium">
            {selectedEventIds.size} selected
          </span>
          <div className="flex items-center gap-1 border-l border-rule pl-3">
            <button
              type="button"
              title="Move all selected 15 minutes earlier"
              onClick={() => handleBulkNudge(-15)}
              className="rounded-full px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              −15m
            </button>
            <button
              type="button"
              title="Move all selected 15 minutes later"
              onClick={() => handleBulkNudge(15)}
              className="rounded-full px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              +15m
            </button>
            <button
              type="button"
              title="Move all selected 1 day later"
              onClick={() => handleBulkNudge(24 * 60)}
              className="rounded-full px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-rule-soft"
            >
              +1d
            </button>
          </div>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={isBulkDeleting}
            className="rounded-full border border-accent px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-wash disabled:opacity-50"
          >
            {isBulkDeleting ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-muted hover:text-ink"
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
          initialEventType={modalState.initialEventType}
          event={null}
          onClose={closeModal}
          googleAccounts={googleAccounts}
        />
      )}
      {modalState?.mode === "edit" && (
        <EventModal
          mode="edit"
          initialStart={modalState.event.start}
          initialEnd={modalState.event.end}
          event={modalState.event}
          onClose={closeModal}
          googleAccounts={googleAccounts}
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
    </div>
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
            <p className="text-xs font-semibold text-ink-2">
              {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              {isSameDay(day, today) && (
                <span className="ml-1.5 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-medium text-paper">
                  Today
                </span>
              )}
            </p>
            {dayEvents.length === 0 ? (
              <p className="mt-1 text-xs text-muted">Nothing scheduled.</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {dayEvents.map((e) => {
                  const colors = e.projectColor ? PROJECT_EVENT_COLORS[e.projectColor] : null;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => onEventClick(e)}
                        className={`flex w-full items-center gap-2 rounded-lg border-l-4 px-3 py-2 text-left text-sm ${colors ? `${colors.bar} ${colors.bg} ${colors.text}` : "border-l-muted bg-rule-soft"}`}
                      >
                        <span className="w-14 flex-shrink-0 font-mono text-xs text-muted">
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
  sharedEvents,
  today,
  onEmptyClick,
  onEventClick,
  draggingEvent,
  onEventDragStart,
  onEventDragEnd,
  scrollToNowRef,
  selectedEventIds,
  onToggleSelect,
  secondaryTimezone,
}: {
  days: Date[];
  events: CalendarEvent[];
  sharedEvents: SharedEvent[];
  today: Date;
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggingEvent: DraggingEvent | null;
  onEventDragStart: (id: string, masterId: string, durationMs: number) => void;
  onEventDragEnd: () => void;
  scrollToNowRef: React.MutableRefObject<(() => void) | null>;
  selectedEventIds: Set<string>;
  onToggleSelect: (id: string) => void;
  secondaryTimezone?: string | null;
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

  const allDayPlacements = useMemo(() => layoutAllDayEvents(events, days), [events, days]);
  const allDayTrackCount = allDayPlacements.reduce((max, p) => Math.max(max, p.track + 1), 0);

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

  // Same direct-DOM-write reasoning as the day column's own now-line —
  // written on nowLabelRef on a timer instead of through React state, so
  // this label's tick doesn't reflow (and fight scroll anchoring on) the
  // whole grid every 30s.
  const nowLabelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tick = () => {
      const el = nowLabelRef.current;
      if (!el) return;
      const current = new Date();
      el.style.top = `${computeNowTop(current)}px`;
      el.textContent = formatTime(current);
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-auto">
      <div className="flex h-full min-h-0 flex-col" style={{ minWidth: `${minWidthRem}rem` }}>
        <div className="flex flex-shrink-0">
          {secondaryTimezone && <div className="w-14 flex-shrink-0" />}
          <div className="w-16 flex-shrink-0" />
          <div className="flex-1 grid" style={gridStyle}>
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className="border-b border-l border-rule px-2 py-1.5 text-center"
                >
                  <div className="font-mono text-xs font-medium text-muted">
                    {dayWeekdayLabel(day)}
                  </div>
                  <div
                    className={
                      isToday
                        ? "mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink font-serif text-lg text-paper"
                        : "font-serif text-xl text-ink-2"
                    }
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {allDayPlacements.length > 0 && (
          <div className="flex flex-shrink-0 border-b border-rule">
            {secondaryTimezone && <div className="w-14 flex-shrink-0" />}
            <div className="flex w-16 flex-shrink-0 items-center justify-end pr-2 font-mono text-[10px] text-muted">
              All day
            </div>
            <div
              className="relative flex-1 py-1"
              style={{ height: `${allDayTrackCount * ALL_DAY_ROW_HEIGHT}px` }}
            >
              {allDayPlacements.map(({ event, col, span, track }) => {
                // Rounded (and a continuation chevron) only on the edge
                // that's the event's real start/end — a squared-off edge
                // signals "this keeps going" the same way Google
                // Calendar's bar does when it's clipped by the visible
                // week, instead of every day's fragment looking identical.
                const isRealStart = isSameDay(startOfDay(event.start), days[col]);
                const isRealEnd = col + span - 1 < days.length && isSameDay(event.end, addDays(startOfDay(days[col + span - 1]), 1));
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    title={event.title}
                    className={`absolute flex items-center truncate border-l-2 border-l-ink-2 bg-rule-soft px-1.5 text-left text-[11px] font-medium text-ink-2 transition-colors hover:brightness-95 ${
                      isRealStart ? "rounded-l-md" : ""
                    } ${isRealEnd ? "rounded-r-md" : ""}`}
                    style={{
                      left: `calc(${(col / days.length) * 100}% + 1px)`,
                      width: `calc(${(span / days.length) * 100}% - 2px)`,
                      top: `${track * ALL_DAY_ROW_HEIGHT}px`,
                      height: `${ALL_DAY_ROW_HEIGHT - 2}px`,
                    }}
                  >
                    {!isRealStart && <span className="mr-1 flex-shrink-0">‹</span>}
                    <span className="truncate">{event.title}</span>
                    {!isRealEnd && <span className="ml-1 flex-shrink-0">›</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div
          ref={scrollRef}
          className="calendar-scroll flex min-h-0 flex-1 overflow-y-auto"
        >
          {secondaryTimezone && (
            <div
              className="w-14 flex-shrink-0 border-r border-rule-soft"
              title={secondaryTimezone}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="pr-1.5 text-right font-mono text-[10px] text-muted"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                >
                  {formatHourLabelInZone(days[0] ?? today, h, secondaryTimezone)}
                </div>
              ))}
            </div>
          )}
          <div className="relative w-16 flex-shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="pr-2 text-right font-mono text-xs text-muted"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {formatHourLabel(h)}
              </div>
            ))}
            {days.some((day) => isSameDay(day, today)) && (
              <div
                ref={nowLabelRef}
                className="pointer-events-none absolute right-2 z-10 -translate-y-1/2 font-mono text-[10px] font-semibold text-accent"
                style={{ top: `${computeNowTop(now)}px` }}
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
                sharedEvents={sharedEvents}
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
  sharedEvents,
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
  sharedEvents: SharedEvent[];
  onEmptyClick: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggingEvent: DraggingEvent | null;
  onEventDragStart: (id: string, masterId: string, durationMs: number) => void;
  onEventDragEnd: () => void;
  selectedEventIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  // Nothing else on this page re-renders on a timer, so without this the
  // line would only move on the next unrelated re-render (a drag, a
  // click, a navigation) — effectively "on refresh" from the user's
  // perspective. Ticked via direct DOM writes on nowLineRef (see below)
  // rather than React state, so it doesn't re-render/reflow the whole
  // column every 30s.
  const nowLineRef = useRef<HTMLDivElement>(null);
  const nowTop = isToday
    ? computeNowTop(new Date())
    : null;
  useEffect(() => {
    if (!isToday) return;
    const tick = () => {
      if (nowLineRef.current) nowLineRef.current.style.top = `${computeNowTop(new Date())}px`;
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [isToday]);
  const dayEvents = useMemo(
    () => events.filter((e) => !e.allDay && isSameDay(e.start, day)),
    [events, day],
  );
  const layout = useMemo(() => layoutOverlappingEvents(dayEvents), [dayEvents]);
  const daySharedEvents = useMemo(
    () => sharedEvents.filter((e) => !e.allDay && isSameDay(e.start, day)),
    [sharedEvents, day],
  );

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
          ? "relative border-l border-rule bg-rule-soft"
          : "relative border-l border-rule"
      }
      style={{ height: `${TOTAL_HEIGHT}px` }}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute left-0 right-0 border-t border-rule-soft"
          style={{
            top: `${(h - HOUR_START) * HOUR_HEIGHT}px`,
            height: `${HOUR_HEIGHT}px`,
          }}
        />
      ))}
      {isToday && (
        // The current-time label lives in the gutter on the left
        // (HourGrid) now — this is just the line across the day itself.
        // Position is written directly to the DOM node on a timer (see
        // the ref effect above) rather than through React state, so the
        // tick doesn't re-render/reflow this column (and its event
        // blocks) every 30s — that reflow was tripping the browser's
        // scroll anchoring into "helpfully" dragging the scroll position
        // down to keep the moving line in the same spot in the viewport.
        <div
          ref={nowLineRef}
          className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-accent"
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
          className="pointer-events-none absolute left-0 right-0 rounded-lg border-2 border-dashed border-muted bg-ink/5"
          style={{
            top: `${(createPreview.lo / 60) * HOUR_HEIGHT}px`,
            height: `${Math.max(
              ((createPreview.hi - createPreview.lo) / 60) * HOUR_HEIGHT,
              4,
            )}px`,
          }}
        />
      )}
      {daySharedEvents.map((event) => {
        const block = computeBlock(event.start, event.end);
        if (!block) return null;
        return (
          <div
            key={event.id}
            title={`${event.ownerLabel}: ${event.title}`}
            // Read-only — no onClick, not draggable, deliberately not an
            // EventBlock. Diagonal stripes (not a solid fill) so it never
            // gets mistaken for one of your own events even at a glance.
            className="pointer-events-none absolute overflow-hidden truncate rounded-md border border-muted/60 px-1.5 py-0.5 text-[10px] text-ink-2"
            style={{
              top: `${block.top}px`,
              height: `${block.height}px`,
              left: "1px",
              right: "1px",
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(113,113,122,0.12), rgba(113,113,122,0.12) 4px, transparent 4px, transparent 8px)",
            }}
          >
            <span className="font-medium">{event.ownerLabel}:</span> {event.title}
          </div>
        );
      })}
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
      className={`group absolute overflow-hidden rounded-lg border-y border-r border-rule border-l-4 bg-surface/40 p-1.5 text-left text-ink transition-all hover:brightness-95 ${color.bar} ${
        isDragging ? "opacity-40" : ""
      } ${selected ? "outline outline-2 outline-accent" : ""}`}
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
              ? "absolute left-1 top-1 text-accent"
              : "absolute left-1 top-1 text-ink-2"
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
        {event.eventType !== "DEFAULT" && (
          <span className="ml-1 rounded bg-ink/10 px-1 py-px text-[9px] font-semibold uppercase opacity-70">
            {event.eventType === "OUT_OF_OFFICE" ? "OOO" : "Focus"}
          </span>
        )}
      </div>
      {displayHeight >= 32 && (
        <div className="truncate font-mono text-[10px] opacity-80">
          {formatTime(event.start)} – {formatTime(displayEnd)}
        </div>
      )}
      {!event.isRecurring && (
        <div
          draggable={false}
          onMouseDown={handleResizeMouseDown}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-muted/60 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Resize event"
        />
      )}
    </button>
  );
}

function MonthView({
  days,
  events,
  sharedEvents = [],
  today,
  viewStart,
  onEmptyClick,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  sharedEvents?: SharedEvent[];
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

  // Shared-calendar overlay (#44) — month view previously showed only
  // your own events, silently dropping any shared-calendar overlap. Just
  // a count badge here, not the full diagonal-stripe blocks the
  // week/day grid renders — a month cell has no room for that detail.
  const sharedCountByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of days) {
      const key = formatYMD(day);
      map.set(key, sharedEvents.filter((ev) => overlapsDay(ev, day)).length);
    }
    return map;
  }, [sharedEvents, days]);

  const currentMonth = viewStart.getMonth();

  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-rule bg-rule">
      {WEEKDAY_LABELS_SUN_FIRST.map((label) => (
        <div
          key={label}
          className="bg-surface px-2 py-1.5 text-center font-mono text-xs font-medium text-muted"
        >
          {label}
        </div>
      ))}
      {days.map((day) => (
        <MonthCell
          key={day.toISOString()}
          day={day}
          events={eventsByDay.get(formatYMD(day)) ?? []}
          sharedCount={sharedCountByDay.get(formatYMD(day)) ?? 0}
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
  sharedCount = 0,
  today,
  inCurrentMonth,
  onEmptyClick,
  onEventClick,
}: {
  day: Date;
  events: CalendarEvent[];
  sharedCount?: number;
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
    ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink font-serif text-sm text-paper"
    : inCurrentMonth
      ? "inline-flex h-6 w-6 items-center justify-center rounded-full font-serif text-sm text-ink transition-colors hover:bg-rule-soft"
      : "inline-flex h-6 w-6 items-center justify-center rounded-full font-serif text-sm text-muted";

  return (
    <div
      onClick={handleClick}
      className="flex min-h-[7rem] cursor-pointer flex-col gap-1 bg-surface p-1.5 transition-colors hover:bg-rule-soft"
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
            className="truncate rounded-md border-l-2 border-l-ink-2 bg-rule-soft px-1.5 py-0.5 text-left text-[11px] text-ink-2 transition-colors hover:brightness-95"
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
            className="px-1.5 font-mono text-[11px] text-muted transition-colors hover:text-ink"
          >
            +{more} more
          </Link>
        )}
        {sharedCount > 0 && (
          <span
            className="truncate rounded-md border-l-2 border-l-muted px-1.5 py-0.5 text-left text-[11px] text-muted"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(113,113,122,0.12), rgba(113,113,122,0.12) 4px, transparent 4px, transparent 8px)",
            }}
          >
            {sharedCount} shared
          </span>
        )}
      </div>
    </div>
  );
}
