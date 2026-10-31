"use client";

import { useState } from "react";
import {
  createReservedProfileAction,
  renameReservedProfileAction,
  deleteReservedProfileAction,
  toggleReservedProfileExemptLabelAction,
  createReservedBlockAction,
  updateReservedBlockAction,
  deleteReservedBlockAction,
} from "../actions";
import { CloseIcon } from "../icons";
import Button from "../ui/Button";

type BlockRow = { id: string; dayOfWeek: number; startMin: number; endMin: number };
type LabelRow = { id: string; name: string; color: string };
type ProfileRow = { id: string; name: string; blocks: BlockRow[]; exemptLabels: LabelRow[] };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A job/class schedule realistically falls somewhere in 6am-midnight —
// narrower than the main calendar's full-day grid so this compact
// settings widget doesn't need its own scroll container.
const GRID_START_MIN = 6 * 60;
const GRID_END_MIN = 24 * 60;
const HOUR_HEIGHT = 32;
const GRANULARITY_MIN = 15;
const MIN_BLOCK_MIN = 30;

function minutesToTop(min: number): number {
  return ((min - GRID_START_MIN) / 60) * HOUR_HEIGHT;
}
function heightForRange(startMin: number, endMin: number): number {
  return ((endMin - startMin) / 60) * HOUR_HEIGHT;
}
function snap(min: number): number {
  return Math.round(min / GRANULARITY_MIN) * GRANULARITY_MIN;
}
function clampToGrid(min: number): number {
  return Math.min(GRID_END_MIN, Math.max(GRID_START_MIN, min));
}
function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
function minutesToTimeInput(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function timeInputToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * A drag-to-build weekly grid, one per named ReservedProfile (Work,
 * School, ...) — the same click-and-drag-to-create / drag-edge-to-resize
 * interaction as the main calendar's day view (CalendarClient.tsx),
 * scoped to a 7-day template with no real dates, just day-of-week +
 * minutes. Each block is independent (its own day, its own start/end)
 * rather than one shared range across a day set. Clicking a block's body
 * (not its resize edges or delete button) opens exact time inputs, for
 * when a drag isn't precise enough — same "edit it like an event" as the
 * main calendar's edit modal.
 */
export default function ReservedHoursManager({
  reservedProfiles,
  labels,
}: {
  reservedProfiles: ProfileRow[];
  labels: LabelRow[];
}) {
  const [profiles, setProfiles] = useState(reservedProfiles);
  const [newProfileName, setNewProfileName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const created = await createReservedProfileAction(newProfileName);
      if (created) setProfiles((prev) => [...prev, created]);
      setNewProfileName("");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    await deleteReservedProfileAction(id);
  };

  return (
    <div className="flex flex-col gap-6">
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          labels={labels}
          onDelete={() => handleDeleteProfile(profile.id)}
          onChange={(next) =>
            setProfiles((prev) => prev.map((p) => (p.id === profile.id ? next : p)))
          }
        />
      ))}
      <form onSubmit={handleCreateProfile} className="flex items-center gap-2">
        <input
          type="text"
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.target.value)}
          placeholder="New profile name (e.g. Work, School)"
          className="w-64 rounded-lg border border-rule bg-paper px-3 py-2 text-sm text-ink"
        />
        <Button type="submit" variant="secondary" pending={isCreating}>
          Add profile
        </Button>
      </form>
    </div>
  );
}

function ProfileCard({
  profile,
  labels,
  onDelete,
  onChange,
}: {
  profile: ProfileRow;
  labels: LabelRow[];
  onDelete: () => void;
  onChange: (next: ProfileRow) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [draft, setDraft] = useState<{ day: number; startMin: number; endMin: number } | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const gridHeight = ((GRID_END_MIN - GRID_START_MIN) / 60) * HOUR_HEIGHT;
  const hours = Array.from(
    { length: (GRID_END_MIN - GRID_START_MIN) / 60 },
    (_, i) => GRID_START_MIN / 60 + i,
  );
  const editingBlock = profile.blocks.find((b) => b.id === editingBlockId) ?? null;
  const exemptLabelIds = new Set(profile.exemptLabels.map((l) => l.id));

  const handleRenameBlur = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === profile.name) {
      setName(profile.name);
      return;
    }
    onChange({ ...profile, name: trimmed });
    await renameReservedProfileAction(profile.id, trimmed);
  };

  const handleToggleLabel = async (labelId: string) => {
    const exempt = !exemptLabelIds.has(labelId);
    const label = labels.find((l) => l.id === labelId);
    if (!label) return;
    onChange({
      ...profile,
      exemptLabels: exempt
        ? [...profile.exemptLabels, label]
        : profile.exemptLabels.filter((l) => l.id !== labelId),
    });
    await toggleReservedProfileExemptLabelAction(profile.id, labelId, exempt);
  };

  const handleColumnMouseDown = (day: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-reserved-block]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorMin = clampToGrid(GRID_START_MIN + (e.clientY - rect.top) * (60 / HOUR_HEIGHT));

    const onMove = (ev: MouseEvent) => {
      const min = clampToGrid(GRID_START_MIN + (ev.clientY - rect.top) * (60 / HOUR_HEIGHT));
      setDraft({ day, startMin: Math.min(anchorMin, min), endMin: Math.max(anchorMin, min) });
    };

    const onUp = async (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraft(null);
      const releaseMin = clampToGrid(GRID_START_MIN + (ev.clientY - rect.top) * (60 / HOUR_HEIGHT));
      let startMin = snap(Math.min(anchorMin, releaseMin));
      let endMin = snap(Math.max(anchorMin, releaseMin));
      if (endMin - startMin < MIN_BLOCK_MIN) endMin = startMin + MIN_BLOCK_MIN;
      if (endMin > GRID_END_MIN) {
        endMin = GRID_END_MIN;
        startMin = endMin - MIN_BLOCK_MIN;
      }
      const created = await createReservedBlockAction(profile.id, day, startMin, endMin);
      if (created) onChange({ ...profile, blocks: [...profile.blocks, created] });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleResizeMouseDown = (
    block: BlockRow,
    edge: "top" | "bottom",
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const originalStart = block.startMin;
    const originalEnd = block.endMin;
    let latestStart = originalStart;
    let latestEnd = originalEnd;

    const onMove = (ev: MouseEvent) => {
      const deltaMin = (ev.clientY - startY) * (60 / HOUR_HEIGHT);
      if (edge === "top") {
        let newStart = snap(originalStart + deltaMin);
        newStart = Math.min(newStart, originalEnd - MIN_BLOCK_MIN);
        newStart = Math.max(newStart, GRID_START_MIN);
        latestStart = newStart;
      } else {
        let newEnd = snap(originalEnd + deltaMin);
        newEnd = Math.max(newEnd, originalStart + MIN_BLOCK_MIN);
        newEnd = Math.min(newEnd, GRID_END_MIN);
        latestEnd = newEnd;
      }
      onChange({
        ...profile,
        blocks: profile.blocks.map((b) =>
          b.id === block.id ? { ...b, startMin: latestStart, endMin: latestEnd } : b,
        ),
      });
    };

    const onUp = async () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (latestStart !== originalStart || latestEnd !== originalEnd) {
        await updateReservedBlockAction(block.id, block.dayOfWeek, latestStart, latestEnd);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDeleteBlock = async (id: string) => {
    onChange({ ...profile, blocks: profile.blocks.filter((b) => b.id !== id) });
    await deleteReservedBlockAction(id);
  };

  const handleSaveEditedTime = async (block: BlockRow, startMin: number, endMin: number, dayOfWeek: number) => {
    onChange({
      ...profile,
      blocks: profile.blocks.map((b) => (b.id === block.id ? { ...b, startMin, endMin, dayOfWeek } : b)),
    });
    setEditingBlockId(null);
    await updateReservedBlockAction(block.id, dayOfWeek, startMin, endMin);
  };

  return (
    <div className="rounded-lg border border-rule p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRenameBlur}
          className="rounded-lg border border-transparent bg-transparent px-1 py-0.5 font-serif text-lg text-ink transition-colors hover:border-rule focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete the "${profile.name}" profile and its blocks?`)) onDelete();
          }}
          className="text-xs text-muted transition-colors hover:text-accent"
        >
          Delete profile
        </button>
      </div>

      {labels.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Exempt labels:</span>
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => handleToggleLabel(label.id)}
              className={
                exemptLabelIds.has(label.id)
                  ? "rounded-full bg-ink px-2.5 py-1 text-xs font-medium text-paper transition-colors hover:opacity-85"
                  : "rounded-full border border-rule px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-rule-soft"
              }
            >
              {label.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <div className="flex min-w-[640px]">
          <div className="w-12 flex-shrink-0">
            <div className="h-6" />
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="relative">
                <span className="absolute -top-2 right-2 text-[10px] text-muted">
                  {formatMinutes(h * 60)}
                </span>
              </div>
            ))}
          </div>
          {DAY_LABELS.map((label, day) => (
            <div key={day} className="flex-1 border-l border-rule">
              <div className="flex h-6 items-center justify-center text-xs font-medium text-ink-2">
                {label}
              </div>
              <div
                className="relative cursor-crosshair select-none border-t border-rule bg-paper"
                style={{ height: gridHeight }}
                onMouseDown={(e) => handleColumnMouseDown(day, e)}
              >
                {hours.map((h, i) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-rule/60"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                ))}
                {draft && draft.day === day && (
                  <div
                    className="absolute inset-x-0.5 rounded bg-accent/20"
                    style={{
                      top: minutesToTop(draft.startMin),
                      height: heightForRange(draft.startMin, draft.endMin),
                    }}
                  />
                )}
                {profile.blocks
                  .filter((b) => b.dayOfWeek === day)
                  .map((b) => (
                    <div
                      key={b.id}
                      data-reserved-block
                      onClick={() => setEditingBlockId(b.id)}
                      className="group absolute inset-x-0.5 cursor-pointer overflow-hidden rounded-md border border-rule bg-ink/10 text-[10px] text-ink"
                      style={{ top: minutesToTop(b.startMin), height: heightForRange(b.startMin, b.endMin) }}
                    >
                      <div
                        onMouseDown={(e) => handleResizeMouseDown(b, "top", e)}
                        className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize"
                      />
                      <div className="flex items-center justify-between gap-1 px-1 pt-0.5">
                        <span className="truncate">{formatMinutes(b.startMin)}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBlock(b.id);
                          }}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="Delete reserved block"
                        >
                          <CloseIcon className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <div
                        onMouseDown={(e) => handleResizeMouseDown(b, "bottom", e)}
                        className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize"
                      />
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Drag on the grid to add a block, drag its edge to resize, or click a block to type an exact time.
      </p>

      {editingBlock && (
        <BlockTimeEditor
          block={editingBlock}
          onCancel={() => setEditingBlockId(null)}
          onSave={(startMin, endMin, dayOfWeek) =>
            handleSaveEditedTime(editingBlock, startMin, endMin, dayOfWeek)
          }
        />
      )}
    </div>
  );
}

function BlockTimeEditor({
  block,
  onCancel,
  onSave,
}: {
  block: BlockRow;
  onCancel: () => void;
  onSave: (startMin: number, endMin: number, dayOfWeek: number) => void;
}) {
  const [day, setDay] = useState(block.dayOfWeek);
  const [start, setStart] = useState(minutesToTimeInput(block.startMin));
  const [end, setEnd] = useState(minutesToTimeInput(block.endMin));
  const startMin = timeInputToMinutes(start);
  const endMin = timeInputToMinutes(end);
  const invalid = !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-rule-soft p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Day</span>
        <select
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          className="rounded-lg border border-rule bg-paper px-2 py-2 text-sm"
        >
          {DAY_LABELS.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Start</span>
        <input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-lg border border-rule bg-paper px-2 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-2">End</span>
        <input
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-lg border border-rule bg-paper px-2 py-2 text-sm"
        />
      </label>
      <Button type="button" disabled={invalid} onClick={() => onSave(startMin, endMin, day)}>
        Save
      </Button>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
