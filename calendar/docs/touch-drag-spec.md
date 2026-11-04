# Touch drag for the phone calendar (spec)

Status: DRAFT for owner review. Nothing here is built.
Written 2026-11-04. Relates to PR #98 (drop skeleton, grab offset) which shipped the desktop half.

## 1. Problem

On phones (below the `sm` breakpoint, 640px) the calendar renders `AgendaView` only
(`CalendarClient.tsx`, the `sm:hidden` branch). There is no time grid, so there is nothing
to drag. The grid (`HourGrid` / `DayColumn` / `EventBlock`) is `hidden sm:flex`.

Even if the grid were shown, the move code is native HTML5 drag and drop
(`draggable`, `onDragStart`, `onDragOver`, `onDrop`). On touch screens that API is
unreliable: it depends on browser-specific long-press behavior, gives no control over the
drag image, does not auto-scroll the grid, and fights the page's own scrolling. It cannot
be made to feel precise.

Goal: on a phone, a user can long-press an event, drag it to a new time, see exactly where
it will land before letting go, and undo a misdrop.

## 2. Non-goals (v1)

- Resizing an event by touch. A 30 minute block is 24px tall; edge handles are not
  touchable. Tap the event and edit the time in the modal.
- Dragging recurring events (desktop already blocks this, `draggable={!event.isRecurring}`).
- Dragging across days. v1 is vertical movement inside one day (see 4.1 for why, and 9 for v2).
- Multi-select drag.
- Replacing the desktop mouse path. Mouse keeps native drag and the existing skeleton.

## 3. Decisions to make first

| # | Decision | Recommendation |
|---|---|---|
| D1 | What do phones show? | Day view on phones renders the hour grid (one full-width column). Week stays the agenda list. |
| D2 | Cross-day moves on phones | Not in v1. Use the event modal to change the date. v2 adds a 3-day grid. |
| D3 | Misdrop recovery | Always show a "Moved. Undo" toast (existing `toast.ts`) for 6 seconds. |
| D4 | Locked events | Keep the confirm, but as an in-app sheet on touch; `window.confirm` is poor on phones. |

D1 is the one that needs the owner. If phones keep the agenda only, there is no drag target and
this spec does not apply.

## 4. Design

### 4.1 Why Day view first

A week of 7 columns on a 390px screen gives 50px columns: too narrow to hit or read.
One column is about 330px wide, which fits a block with its title and a finger. It also
removes the hard part (which day is under the finger) from v1.

### 4.2 Hour height must become a variable

`HOUR_HEIGHT = 48` is a module constant used by layout, now-line, create preview, resize and
the drop math. Touch needs about 64px per hour so a 15 minute snap is 16px, comfortably
bigger than finger jitter. This change also unlocks the open "fill the screen" item (scale
hours to the viewport).

- Add `hourHeight` as a prop on `HourGrid` and `DayColumn`, passed down to `EventBlock`.
- Replace uses of the constant with the prop. Keep 48 as the desktop default so desktop is
  unchanged.
- This is PR 1 below and is independently shippable and testable.

### 4.3 Interaction model

States for one drag: `idle -> pressing -> lifted -> idle` (commit) or `-> idle` (cancel).

1. **pressing**: `pointerdown` with `pointerType === "touch"` on an `EventBlock`. Start a
   350ms timer. If the pointer moves more than 8px before it fires, cancel and let the
   browser scroll (this is what keeps scrolling working when a finger starts on an event).
2. **lifted**: timer fires. Call `navigator.vibrate?.(10)`, set pointer capture, mark the
   block lifted (scale 1.02, shadow, `opacity-40` on the original like desktop), and from
   now on call `preventDefault()` on `touchmove` so the page does not scroll.
3. **dragging**: on each `pointermove`, compute the snapped start with the same function the
   desktop path uses (`dropStartFor`, section 4.4) and update the skeleton. Show a time bubble
   above the finger: "2:15 PM - 3:00 PM". Auto-scroll near the edges (4.5).
4. **commit**: `pointerup` over the grid calls the same `moveEvent(masterId, startIso, endIso)`
   server action as desktop. Show the undo toast.
5. **cancel**: `pointercancel`, release outside the grid, or release within the top header
   strip: revert, no server call.

The finger hides the block, so the skeleton is drawn at the snapped slot and a copy of the
block is drawn offset 48px above the fingertip as the visible "held" object.

### 4.4 Shared logic, one source of truth

Desktop and touch must agree on where a block lands or the "inaccurate" bug returns.

- Extract the pure part of today's `dropStartFor` into
  `calendar-dates.ts` (it already has a unit test file): 
  `computeDropStart({ day, pointerY, columnTop, grabOffsetMinutes, hourHeight, snapMinutes })`.
- `DayColumn` desktop code calls it; the touch controller calls it. No second copy of the math.
- Snap stays 15 minutes (`MOVE_SNAP_MINUTES`).

### 4.5 Auto-scroll

Within 56px of the scroll container's top or bottom edge, scroll by up to 12px per animation
frame, scaled by how close the finger is. Recompute the skeleton every frame using the live
`getBoundingClientRect()` of the column so scrolling and finger position stay consistent.
Stop on lift-off, cancel, or when the finger leaves the edge zone.

### 4.6 Touch plumbing that has to be right

- `touch-action: pan-y` on blocks (vertical scroll still works before the long press).
- Register the `touchmove` listener natively with `{ passive: false }` once lifted. React's
  `onTouchMove` is passive and `preventDefault()` is ignored there.
- `-webkit-touch-callout: none`, `user-select: none` and a `contextmenu` `preventDefault()` on
  blocks, or iOS shows the callout and Android selects text on long press.
- `overscroll-behavior: contain` on `.calendar-scroll` so dragging near the top does not
  trigger pull-to-refresh.
- Native drag must not start on touch: in `onDragStart`, if the interaction began as a touch,
  `preventDefault()`.
- Pointer events only for `pointerType === "touch"` (and `"pen"`). Mouse stays on native drag.

### 4.7 Which events can lift

- Not recurring (series moves are off, same as desktop).
- Not read-only/shared (`sharedEvents` render as plain blocks with no handlers).
- Must be editable. `moveEvent` silently updates zero rows for sources outside
  `EDITABLE_SOURCES`, so a drag of such an event would "work" in the UI and then snap back.
  Open question Q2.
- Locked events lift but confirm on commit (D4).

For blocked events, a long press shows a short toast ("Recurring events can't be dragged. Tap
to edit.") instead of doing nothing.

### 4.8 Undo

On commit, capture the old `start`/`end` and show the toast "Moved to 2:15 PM. Undo". Undo
calls `moveEvent` with the old times. The scheduler may have rescheduled other task blocks
because of the move (`rescheduleConflictsWith`); undo restores this event only. Say so in the
toast copy only if that happens in testing; otherwise leave it.

## 5. Files expected to change

| File | Change |
|---|---|
| `src/app/calendar/CalendarClient.tsx` | `hourHeight` prop; render `HourGrid` on phones for Day view; `EventBlock` touch handlers |
| `src/app/calendar/useTouchEventDrag.ts` (new) | the controller in 4.3 (state machine, timers, autoscroll); no JSX |
| `src/lib/calendar-dates.ts` | `computeDropStart` (pure) |
| `src/app/globals.css` | `.calendar-scroll { overscroll-behavior: contain }`, touch utility classes |
| `src/lib/calendar-dates.test.ts` | unit tests for `computeDropStart` |
| `tests/e2e/event-touch-drag.spec.ts` (new) | touch e2e (section 7) |

No schema change and no new server action.

## 6. Rollout: three PRs

1. **hourHeight prop + phone Day grid, no drag.** Visible win on its own (phones get a real
   time grid), and it removes the constant that blocks the fill-the-screen item. Desktop
   must be pixel-identical: the existing `event-drag-drop` and `event-modal` e2e specs are the
   check.
2. **`computeDropStart` extraction + touch controller + e2e.** The actual feature.
3. **Polish:** haptics, undo toast, edge auto-scroll tuning, blocked-event toast, locked sheet.

Merge order matters: 2 depends on 1. Each ships and deploys on its own; the deploy is
`scripts/deploy-season-prod.sh` from a clean checkout of `main`.

## 7. Testing

Owner rule: every behavior gets a test that fails when the behavior is removed. Mutation-check each.

**Unit (`tsx`, no browser):** `computeDropStart` with grab offsets, 15 minute snapping,
clamping at the top, `null` past the last hour, different `hourHeight` values.
Mutation: ignore `grabOffsetMinutes` and the test must fail.

**E2E (Playwright, touch):** `page.touchscreen` only supports taps, so use a CDP session and
`Input.dispatchTouchEvent` (`touchStart`, wait 400ms, several `touchMove`, `touchEnd`) in a
context with `hasTouch: true` and a 390x844 viewport. Real touch events are required because
the risks are passive listeners and `touch-action`, which synthetic `PointerEvent`s do not exercise.
Cases:

1. Long press then drag shows `[data-drop-skeleton]`; release moves the event; skeleton gone.
2. Skeleton top edge equals the block's new top edge (accuracy, same tolerance as desktop).
3. Short swipe that starts on an event scrolls the grid and does not lift it
   (mutation: remove the 8px cancel and this fails).
4. Drop outside the grid or `pointercancel` makes no server write (assert the event time is unchanged).
5. Undo restores the original time.
6. A recurring event does not lift and shows the toast.

**Real devices (manual, cannot be automated):** iOS Safari and Android Chrome. Check: no
callout or text selection on long press, no pull-to-refresh, no back-swipe stealing the drag at
the left edge, scrolling still smooth, haptic fires. This is a release checklist item for PR 2.

## 8. Acceptance criteria

- On a 390px phone, Day view shows a scrollable hour grid.
- Long press (350ms) lifts an editable event; the original dims and a held copy follows the finger.
- A dashed skeleton with the start time shows the landing slot throughout the drag; releasing
  puts the block's top edge exactly there (15 minute snap).
- Scrolling by swiping still works, including when the swipe starts on an event.
- Dragging near the top or bottom edge scrolls the grid.
- Cancel paths never write. Commit shows an Undo toast that works.
- Desktop behavior and its tests are unchanged.

## 9. Later (v2)

- 3-day grid on phones with cross-day drops (finger x picks the column).
- Hold at the screen edge to flip to the next or previous day mid-drag.
- Touch resize via handles that appear after lift.
- Tap-to-place alternative: select a block, tap a slot.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Long press conflicts with browser gestures (iOS callout, Android text select) | 4.6 CSS and `contextmenu` suppression; real-device checklist |
| Passive listener silently ignores `preventDefault`, page scrolls under the drag | Native `{ passive: false }` listener; e2e case 3 and 1 |
| Desktop regression from the `hourHeight` refactor | PR 1 is refactor-only; desktop e2e specs gate it |
| Silent no-op moves for non-editable event sources | Q2 below, refuse the lift and toast |
| Recoverability on a misdrop | D3 undo toast |

## 11. Open questions for the owner

- Q1: Is D1 right, i.e. should Day view on phones become a time grid? The agenda list stays for Week.
- Q2: `EDITABLE_SOURCES` in `actions.ts` is `LOCAL` and `GOOGLE`, and `CalendarEvent` on the client
  has no `source` field, so the client cannot tell. Proposal: add an `editable` boolean to
  `CalendarEvent`, computed on the server in `home/page.tsx`, and use it to refuse the lift
  (desktop would benefit too, today it snaps back silently for other sources).
- Q3: Is 350ms the right long-press time? (iOS default is about 500ms; shorter feels snappier
  but misfires while scrolling.) Make it one constant so it is easy to tune.
- Q4: Should the Undo window be 6 seconds?
