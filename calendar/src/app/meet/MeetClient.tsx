"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGroupMeetingAction, findGroupMeetingSlotAction } from "../actions";
import { formatDueDateTime } from "@/lib/calendar-dates";
import Button from "../ui/Button";

type Person = { id: string; name: string | null; email: string };

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

export default function MeetClient({ people }: { people: Person[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [durationMin, setDurationMin] = useState(30);
  const [title, setTitle] = useState("");
  const [isFinding, setIsFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ startIso: string; endIso: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFind = async () => {
    setIsFinding(true);
    setError(null);
    setSlot(null);
    setCreated(false);
    try {
      const result = await findGroupMeetingSlotAction([...selected], durationMin);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSlot({ startIso: result.startIso, endIso: result.endIso });
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsFinding(false);
    }
  };

  const handleCreate = async () => {
    if (!slot) return;
    setIsCreating(true);
    try {
      await createGroupMeetingAction([...selected], title, slot.startIso, slot.endIso);
      setCreated(true);
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating the event. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div>
        <p className="text-sm text-zinc-500">Who&apos;s meeting</p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {people.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-600">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                {p.name ?? p.email}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Group meeting"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Duration</span>
        <select
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className={`${inputClass} max-w-[10rem]`}
        >
          {[15, 30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {!slot && (
        <div>
          <Button type="button" onClick={handleFind} disabled={selected.size === 0} pending={isFinding}>
            {isFinding ? "Looking…" : "Find a time"}
          </Button>
        </div>
      )}

      {slot && !created && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-800 dark:bg-indigo-950/30">
          <p className="font-medium text-indigo-900 dark:text-indigo-100">
            Everyone&apos;s free {formatDueDateTime(new Date(slot.startIso))} –{" "}
            {formatDueDateTime(new Date(slot.endIso))}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" onClick={handleCreate} pending={isCreating}>
              {isCreating ? "Creating…" : "Create event"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSlot(null)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {created && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
          Created on your calendar.
        </p>
      )}
    </div>
  );
}
