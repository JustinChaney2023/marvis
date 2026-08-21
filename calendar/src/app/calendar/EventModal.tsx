"use client";

import { useEffect, useRef, useState } from "react";
import {
  createEvent,
  deleteEvent,
  updateEvent,
  updateEventOccurrence,
  deleteEventOccurrence,
  addEventGuestAction,
  removeEventGuestAction,
  getEventGuestsAction,
} from "../actions";
import { toLocalInputValue, formatYMD, parseYMD } from "@/lib/calendar-dates";
import { CloseIcon } from "../icons";
import Button from "../ui/Button";
import {
  RECURRENCE_PRESETS,
  WEEKDAY_CODES,
  buildCustomWeeklyRule,
  parseCustomWeeklyDays,
  type WeekdayCode,
} from "@/lib/recurrence";
import { PROJECT_EVENT_COLORS } from "@/lib/eventColors";
import NotesEditor from "../ui/NotesEditor";

export type EventModalEvent = {
  id: string;
  title: string;
  notes: string | null;
  start: Date;
  end: Date;
  recurrenceRule: string | null;
  locked: boolean;
  meetingUrl: string | null;
  // The event's currently-*resolved* color (its own override, else its
  // task's, else its task's project's) — not necessarily an explicit
  // override already stored on this row. Saving without touching the
  // Color field re-pins whatever's showing as this event's own explicit
  // color, same as any other field in this form.
  color: string | null;
  eventType: "DEFAULT" | "OUT_OF_OFFICE" | "FOCUS_TIME";
  allDay: boolean;
  reminderMinutes: number | null;
};

const REMINDER_MINUTES_PRESETS = [
  { value: "", label: "None" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
] as const;

const EVENT_TYPE_OPTIONS = [
  { value: "DEFAULT", label: "Default" },
  { value: "OUT_OF_OFFICE", label: "Out of office" },
  { value: "FOCUS_TIME", label: "Focus time" },
] as const;

const EVENT_COLOR_OPTIONS = Object.keys(PROJECT_EVENT_COLORS);

type Props = {
  mode: "create" | "edit";
  initialStart: Date;
  initialEnd: Date;
  // Quick-create prefill (e.g. the "+ Focus block" button) — ignored in
  // edit mode, which always derives its initial values from `event`.
  initialTitle?: string;
  initialLocked?: boolean;
  initialEventType?: EventModalEvent["eventType"];
  event: EventModalEvent | null;
  onClose: () => void;
};

const WEEKDAY_SHORT_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const WEEKDAY_FULL_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const inputClass =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function EventModal({
  mode,
  initialStart,
  initialEnd,
  initialTitle: prefillTitle,
  initialLocked,
  initialEventType,
  event,
  onClose,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAllDay, setIsAllDay] = useState(() => (mode === "edit" ? !!event?.allDay : false));
  const [recurrenceSelection, setRecurrenceSelection] = useState<string>(() => {
    const rule =
      mode === "edit" && event?.recurrenceRule ? event.recurrenceRule : "";
    if (RECURRENCE_PRESETS.some((p) => p.value === rule)) return rule;
    // Unrecognized rule (e.g. an imported Google rule this UI doesn't have
    // controls for) — surface as Custom so the user can see/edit it instead
    // of silently dropping the recurrence.
    return "CUSTOM";
  });
  const [customDays, setCustomDays] = useState<WeekdayCode[]>(() => {
    if (mode === "edit" && event?.recurrenceRule) {
      return parseCustomWeeklyDays(event.recurrenceRule) ?? [];
    }
    return [];
  });
  // If the event's rule didn't match a preset AND didn't parse as a
  // custom-weekly BYDAY rule (e.g. a Google-synced class schedule with
  // UNTIL/WKST), the Custom UI has no way to represent it and would
  // otherwise silently rebuild it as a bare "FREQ=WEEKLY" (or worse,
  // "every day this button is checked") the moment the user saves ANY
  // change to the event — including just retitling it. Preserve the
  // original string verbatim unless the user actually touches the
  // Repeat controls, so an unrelated edit can't destroy it. This
  // corruption would also sync back to the real Google Calendar event.
  const [initialUnrecognizedRule] = useState<string | null>(() => {
    if (mode !== "edit" || !event?.recurrenceRule) return null;
    if (RECURRENCE_PRESETS.some((p) => p.value === event.recurrenceRule)) {
      return null;
    }
    if (parseCustomWeeklyDays(event.recurrenceRule)) return null;
    return event.recurrenceRule;
  });
  const [repeatTouched, setRepeatTouched] = useState(false);
  // "This event" vs "All events" (#40) — only meaningful while editing a
  // raw recurring occurrence (isEditingRecurring below). Defaults to the
  // series-wide behavior this app already had, so it's opt-in rather
  // than a surprise change to existing muscle memory.
  const [editScope, setEditScope] = useState<"series" | "occurrence">("series");

  type Guest = { id: string; email: string; status: "PENDING" | "ACCEPTED" | "DECLINED" | "TENTATIVE" };
  const [guests, setGuests] = useState<Guest[]>([]);
  const [guestEmail, setGuestEmail] = useState("");
  const [isAddingGuest, setIsAddingGuest] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && event) {
      getEventGuestsAction(event.id).then(setGuests);
    }
  }, [mode, event]);

  const handleAddGuest = async () => {
    if (!event || !guestEmail.trim() || isAddingGuest) return;
    setIsAddingGuest(true);
    setGuestError(null);
    try {
      const result = await addEventGuestAction(event.id, guestEmail);
      if (result.ok) {
        setGuestEmail("");
        setGuests(await getEventGuestsAction(event.id));
      } else {
        setGuestError(result.error);
      }
    } finally {
      setIsAddingGuest(false);
    }
  };

  const handleRemoveGuest = async (guestId: string) => {
    await removeEventGuestAction(guestId);
    setGuests((prev) => prev.filter((g) => g.id !== guestId));
  };

  const titleInputRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    const formData = new FormData(e.currentTarget);

    // The UI uses separate date + time inputs (better native pickers than
    // datetime-local). Combine each pair back into the "YYYY-MM-DDTHH:mm"
    // format the server action expects, in local time.
    const sd = startDateRef.current?.value ?? "";
    const st = startTimeRef.current?.value ?? "";
    const ed = endDateRef.current?.value ?? "";
    const et = endTimeRef.current?.value ?? "";
    if (isAllDay) {
      // The end-date input shows the inclusive last day; store the
      // exclusive day-after (Google Calendar's own all-day convention —
      // see the endDateValue comment above) so display/layout math
      // elsewhere doesn't need a separate all-day code path.
      formData.set("start", `${sd}T00:00`);
      const exclusiveEnd = new Date(parseYMD(ed || sd).getTime() + 86_400_000);
      formData.set("end", `${formatYMD(exclusiveEnd)}T00:00`);
    } else {
      if (sd && st) formData.set("start", `${sd}T${st}`);
      if (ed && et) formData.set("end", `${ed}T${et}`);
    }

    // "Custom" is a UI-only sentinel — convert it to the actual RRULE
    // (or plain "FREQ=WEEKLY" when no days are selected) before it reaches
    // the server action. Other selections pass through unchanged. If the
    // series came in with a rule this UI can't fully represent and the
    // user never touched Repeat, keep it exactly as-is rather than
    // rebuilding (and destroying) it from the Custom day-toggle state.
    const ruleValue =
      recurrenceSelection === "CUSTOM"
        ? !repeatTouched && initialUnrecognizedRule
          ? initialUnrecognizedRule
          : buildCustomWeeklyRule(customDays)
        : recurrenceSelection;
    formData.set("recurrenceRule", ruleValue);

    setIsSubmitting(true);
    try {
      if (mode === "create") {
        await createEvent(formData);
      } else if (event) {
        if (isEditingRecurring && editScope === "occurrence") {
          await updateEventOccurrence(event.id, event.start.toISOString(), formData);
        } else if (isEditingRecurring) {
          // "All events" from a specific occurrence — see updateEvent's
          // own comment for why the pre-edit occurrence start has to be
          // passed through instead of just the edited form values.
          await updateEvent(event.id, formData, event.start.toISOString());
        } else {
          await updateEvent(event.id, formData);
        }
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!event || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (isEditingRecurring && editScope === "occurrence") {
        await deleteEventOccurrence(event.id, event.start.toISOString());
      } else {
        await deleteEvent(event.id);
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const toggleDay = (code: WeekdayCode) => {
    setRepeatTouched(true);
    setCustomDays((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
    );
  };

  const initialTitle = mode === "edit" && event ? event.title : (prefillTitle ?? "");
  const startValue = toLocalInputValue(
    mode === "edit" && event ? event.start : initialStart,
  );
  const endValue = toLocalInputValue(
    mode === "edit" && event ? event.end : initialEnd,
  );
  const startDateValue = startValue.slice(0, 10);
  const startTimeValue = startValue.slice(11);
  // Stored `end` for an all-day event is the exclusive day *after* the
  // last day (same convention Google Calendar uses) — the date input
  // shows the inclusive last day instead, one day earlier.
  const endDateValue =
    mode === "edit" && event?.allDay
      ? formatYMD(new Date(event.end.getTime() - 86_400_000))
      : endValue.slice(0, 10);
  const endTimeValue = endValue.slice(11);
  const isEditingRecurring = mode === "edit" && !!event?.recurrenceRule;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            {mode === "create" ? "New event" : "Edit event"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Title</span>
              <input
                ref={titleInputRef}
                name="title"
                required
                defaultValue={initialTitle}
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Meeting link (optional)</span>
              <input
                name="meetingUrl"
                type="url"
                placeholder="https://..."
                defaultValue={mode === "edit" ? (event?.meetingUrl ?? "") : ""}
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Notes</span>
            <NotesEditor name="notes" defaultValue={mode === "edit" ? (event?.notes ?? "") : ""} />
          </div>

          {mode === "edit" && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-zinc-500">Guests</span>
              {guests.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {guests.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-zinc-600"
                    >
                      <span className="truncate">{g.email}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={
                            g.status === "ACCEPTED"
                              ? "text-green-600 dark:text-green-400"
                              : g.status === "DECLINED"
                                ? "text-red-600 dark:text-red-400"
                                : g.status === "TENTATIVE"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-zinc-400"
                          }
                        >
                          {g.status.charAt(0) + g.status.slice(1).toLowerCase()}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveGuest(g.id)}
                          className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                          aria-label={`Remove ${g.email}`}
                        >
                          <CloseIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {/* A div, not a nested <form> — this lives inside the main
                  event <form> below, and nested forms are invalid HTML
                  (unpredictable submit/Enter-key behavior, hydration
                  warnings). */}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddGuest();
                    }
                  }}
                  placeholder="guest@example.com"
                  className={`${inputClass} flex-1`}
                />
                <Button type="button" variant="secondary" pending={isAddingGuest} onClick={handleAddGuest}>
                  Invite
                </Button>
              </div>
              {guestError && <span className="text-xs text-red-600 dark:text-red-400">{guestError}</span>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Color</span>
              <select
                name="color"
                defaultValue={(mode === "edit" ? event?.color : null) ?? ""}
                className={inputClass}
              >
                <option value="">Default</option>
                {EVENT_COLOR_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Event type</span>
              <select
                name="eventType"
                defaultValue={
                  mode === "edit" ? (event?.eventType ?? "DEFAULT") : (initialEventType ?? "DEFAULT")
                }
                className={inputClass}
              >
                {EVENT_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-500">Reminder</span>
            <select
              name="reminderMinutes"
              defaultValue={
                mode === "edit"
                  ? (event?.reminderMinutes?.toString() ?? "")
                  : "10"
              }
              className={inputClass}
            >
              {REMINDER_MINUTES_PRESETS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allDay"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-zinc-600"
            />
            <span className="text-zinc-700 dark:text-zinc-300">All day</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Start</span>
              <div className="flex gap-2">
                <input
                  ref={startDateRef}
                  type="date"
                  required
                  defaultValue={startDateValue}
                  className={`${inputClass} flex-[2]`}
                />
                {!isAllDay && (
                  <input
                    ref={startTimeRef}
                    type="time"
                    required
                    defaultValue={startTimeValue}
                    className={`${inputClass} flex-1`}
                  />
                )}
              </div>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">End{isAllDay ? " (last day)" : ""}</span>
              <div className="flex gap-2">
                <input
                  ref={endDateRef}
                  type="date"
                  required
                  defaultValue={endDateValue}
                  className={`${inputClass} flex-[2]`}
                />
                {!isAllDay && (
                  <input
                    ref={endTimeRef}
                    type="time"
                    required
                    defaultValue={endTimeValue}
                    className={`${inputClass} flex-1`}
                  />
                )}
              </div>
            </label>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
            {isEditingRecurring && (
              <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-zinc-100 p-1 text-xs dark:bg-zinc-700">
                {(["occurrence", "series"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setEditScope(scope)}
                    className={
                      editScope === scope
                        ? "rounded-full bg-white px-3 py-1 font-medium text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-50"
                        : "rounded-full px-3 py-1 text-zinc-500 dark:text-zinc-400"
                    }
                  >
                    {scope === "occurrence" ? "This event" : "All events"}
                  </button>
                ))}
              </div>
            )}
            {isEditingRecurring && editScope === "occurrence" ? (
              <p className="text-xs text-zinc-500">
                Saves just this one occurrence as its own event — the rest
                of the series is unaffected.
              </p>
            ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Repeat</span>
              <select
                value={recurrenceSelection}
                onChange={(e) => {
                  setRepeatTouched(true);
                  setRecurrenceSelection(e.target.value);
                }}
                className={inputClass}
              >
                {RECURRENCE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
                <option value="CUSTOM">Custom</option>
              </select>
              {recurrenceSelection === "CUSTOM" && (
                <div className="mt-1.5 flex gap-1.5">
                  {WEEKDAY_CODES.map((code, idx) => {
                    const selected = customDays.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={selected}
                        aria-label={WEEKDAY_FULL_LABELS[idx]}
                        onClick={() => toggleDay(code)}
                        className={
                          selected
                            ? "flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                            : "flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        }
                      >
                        {WEEKDAY_SHORT_LABELS[idx]}
                      </button>
                    );
                  })}
                </div>
              )}
              {initialUnrecognizedRule && !repeatTouched && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  This event has a recurrence pattern (e.g. an end date)
                  this app can&apos;t fully show — it&apos;s kept as-is
                  unless you change Repeat below.
                </span>
              )}
            </label>
            )}
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-700">
            <span className="text-zinc-700 dark:text-zinc-300">
              Locked{" "}
              <span className="text-zinc-500 dark:text-zinc-400">
                (won&apos;t be moved by auto-scheduling — you can still drag it yourself)
              </span>
            </span>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                name="locked"
                defaultChecked={mode === "edit" ? !!event?.locked : !!initialLocked}
                className="peer sr-only"
              />
              <span className="block h-6 w-11 rounded-full bg-zinc-200 transition-colors peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 dark:bg-zinc-700 dark:peer-checked:bg-indigo-500" />
              <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
            </span>
          </label>

          <div className="mt-2 flex items-center justify-between gap-2">
            {mode === "edit" ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="danger" onClick={handleDelete} disabled={isSubmitting}>
                    Delete
                  </Button>
                  <a
                    href={`/api/ics/export?eventId=${event?.id}`}
                    className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    Export .ics
                  </a>
                </div>
                {isEditingRecurring && (
                  <span className="text-xs text-zinc-500">
                    {editScope === "occurrence" ? "Deletes just this event." : "Deletes the whole series."}
                  </span>
                )}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" pending={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}