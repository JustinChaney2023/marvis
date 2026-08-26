"use client";

import { useEffect, useRef, useState } from "react";
import {
  createEvent,
  deleteEvent,
  updateEvent,
  updateEventOccurrence,
  updateEventFollowing,
  deleteEventOccurrence,
  deleteEventFollowing,
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
  location: string | null;
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
  // Which connected Google account this event syncs to, if any — null
  // means "not tied to a specific one yet" (exports to whichever account
  // is currently default; see exportToGoogle in google-sync.ts).
  googleAccountId: string | null;
};

export type GoogleAccountOption = { id: string; label: string };

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
  // Only meaningful with 2+ entries — see the "Sync to" field below,
  // which stays hidden with 0 or 1 connected accounts (nothing to choose).
  googleAccounts?: GoogleAccountOption[];
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
  "rounded-lg border border-rule bg-paper px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none";

export default function EventModal({
  mode,
  initialStart,
  initialEnd,
  initialTitle: prefillTitle,
  initialLocked,
  initialEventType,
  event,
  onClose,
  googleAccounts = [],
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
  const [editScope, setEditScope] = useState<"series" | "occurrence" | "following">("series");

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
        } else if (isEditingRecurring && editScope === "following") {
          await updateEventFollowing(event.id, event.start.toISOString(), formData);
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
      } else if (isEditingRecurring && editScope === "following") {
        await deleteEventFollowing(event.id, event.start.toISOString());
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
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-panel max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-rule bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">
            {mode === "create" ? "New event" : "Edit event"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-rule-soft"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Title</span>
              <input
                ref={titleInputRef}
                name="title"
                required
                defaultValue={initialTitle}
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Meeting link (optional)</span>
              <input
                name="meetingUrl"
                type="url"
                placeholder="https://..."
                defaultValue={mode === "edit" ? (event?.meetingUrl ?? "") : ""}
                className={inputClass}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Location (optional)</span>
            <input
              name="location"
              type="text"
              placeholder="e.g. Room 4B, 123 Main St"
              defaultValue={mode === "edit" ? (event?.location ?? "") : ""}
              className={inputClass}
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Notes</span>
            <NotesEditor name="notes" defaultValue={mode === "edit" ? (event?.notes ?? "") : ""} />
          </div>

          {mode === "edit" && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Guests</span>
              {guests.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {guests.map((g) => (
                    <li
                      key={g.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-rule px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate">{g.email}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={
                            g.status === "DECLINED" ? "text-accent" : "text-muted"
                          }
                        >
                          {g.status.charAt(0) + g.status.slice(1).toLowerCase()}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveGuest(g.id)}
                          className="text-muted hover:text-accent"
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
              {guestError && <span className="text-xs text-accent">{guestError}</span>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Color</span>
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
              <span className="text-muted">Event type</span>
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
            <span className="text-muted">Reminder</span>
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

          {googleAccounts.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Sync to</span>
              <select
                name="googleAccountId"
                defaultValue={(mode === "edit" ? event?.googleAccountId : null) ?? ""}
                className={inputClass}
              >
                <option value="">Default account</option>
                {googleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allDay"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-rule text-accent focus:outline focus:outline-2 focus:outline-accent"
            />
            <span className="text-ink-2">All day</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Start</span>
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
              <span className="text-muted">End{isAllDay ? " (last day)" : ""}</span>
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

          <div className="border-t border-rule pt-4">
            {isEditingRecurring && (
              <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-rule-soft p-1 text-xs">
                {(["occurrence", "following", "series"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setEditScope(scope)}
                    className={
                      editScope === scope
                        ? "rounded-full bg-surface px-3 py-1 font-medium text-ink"
                        : "rounded-full px-3 py-1 text-muted"
                    }
                  >
                    {scope === "occurrence" ? "This event" : scope === "following" ? "This and following" : "All events"}
                  </button>
                ))}
              </div>
            )}
            {isEditingRecurring && editScope === "occurrence" ? (
              <p className="text-xs text-muted">
                Saves just this one occurrence as its own event — the rest
                of the series is unaffected.
              </p>
            ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Repeat</span>
              {editScope === "following" && (
                <p className="mb-1 text-xs text-muted">
                  Splits the series here — earlier occurrences keep their
                  old pattern, this and every occurrence after it become a
                  new series with whatever you set below.
                </p>
              )}
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
                            ? "flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-xs font-semibold text-paper transition-colors hover:opacity-85"
                            : "flex h-9 w-9 items-center justify-center rounded-lg border border-rule text-xs font-semibold text-ink-2 transition-colors hover:bg-rule-soft"
                        }
                      >
                        {WEEKDAY_SHORT_LABELS[idx]}
                      </button>
                    );
                  })}
                </div>
              )}
              {initialUnrecognizedRule && !repeatTouched && (
                <span className="text-xs text-accent">
                  This event has a recurrence pattern (e.g. an end date)
                  this app can&apos;t fully show — it&apos;s kept as-is
                  unless you change Repeat below.
                </span>
              )}
            </label>
            )}
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-rule pt-4 text-sm">
            <span className="text-ink-2">
              Locked{" "}
              <span className="text-muted">
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
              <span className="block h-6 w-11 rounded-full bg-rule-soft transition-colors peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent" />
              <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-paper transition-transform peer-checked:translate-x-5" />
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
                    className="text-xs text-muted underline hover:text-ink-2"
                  >
                    Export .ics
                  </a>
                  {/* Links out rather than embedding the recorder here: a
                      capture that dies when this modal closes is exactly
                      the failure mode a lecture recorder can't have. */}
                  <a
                    href={`/recordings?eventId=${event?.id}`}
                    className="text-xs text-muted underline hover:text-ink-2"
                  >
                    Record
                  </a>
                  <a
                    href={`/timer?eventId=${event?.id}`}
                    className="text-xs text-muted underline hover:text-ink-2"
                  >
                    Timer
                  </a>
                </div>
                {isEditingRecurring && (
                  <span className="text-xs text-muted">
                    {editScope === "occurrence"
                      ? "Deletes just this event."
                      : editScope === "following"
                        ? "Deletes this and every later occurrence — earlier ones are kept."
                        : "Deletes the whole series."}
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