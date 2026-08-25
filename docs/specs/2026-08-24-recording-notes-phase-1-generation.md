# Recording Notes Generation (Phase 1) Specification

Status: Draft v1

ADR: [docs/decisions/2026-08-24-recording-notes-obsidian-sync-direction.md](../decisions/2026-08-24-recording-notes-obsidian-sync-direction.md)

Purpose: Upgrade `summarizeTranscript()` so a recording's generated notes clarify confusing terms and connect a lecture's ideas to prior recordings in the same course, in addition to the existing summary/key-points/action-items.

This spec is a living document: when implementation deviates from it or new requirements surface, update it in the same PR as the change.

## 0. Background

Full Discovery Summary lives in the linked ADR's Context section. Summary: Justin (sole user) gets flat, transcript-bound lecture notes today from `summarizeTranscript()` in `src/lib/recordings.ts` — deliberately conservative, restating only what's in the transcript. He wants richer structure and content that clarifies jargon and connects ideas across a course, without inventing facts. This is Phase 1 of a two-phase effort (see ADR Phasing); Phase 2 (Obsidian vault sync) is out of scope here.

## 1. Problem Statement

`summarizeTranscript()` produces `{summary, keyPoints, actionItems}` from a raw transcript via one (or several, for long recordings) LLM call. The output is markdown-formatted but structurally flat — a paragraph summary plus a bullet list — and never does more than restate the transcript. It doesn't:
- explain jargon or acronyms the transcript uses without defining,
- note how this lecture's ideas relate to earlier recordings in the same course,
- visually distinguish "what was said" from "what the system added for clarity."

**Important boundary:** this system does not decide whether a connection or clarification is *correct* beyond what the transcript and prior notes support — it is explicitly barred from inventing facts not traceable to the transcript or to a prior recording's stored notes for the same project. It does not fetch external sources (web search, textbooks) — "going outside the course" is limited to what the model already knows, offered as an optional aside, never as a required output.

## 2. Goals and Non-Goals

### Goals
- `summarizeTranscript()` additionally returns `clarifications` (jargon/acronyms explained in plain language) and `connections` (links to prior recordings in the same course), each possibly empty.
- Course context for `connections` is built from prior `DONE` recordings' stored `summary` for the same `projectId` — no new database columns, no schema migration.
- The rendered `Recording.summary` markdown visually separates AI-added clarifications/connections from the core transcript-derived summary, using Obsidian callout syntax; the in-app renderer degrades this to a plain blockquote with the literal marker text visible, which Section 8 documents as acceptable.
- Total added LLM input tokens per recording is bounded by a fixed character budget on injected course context (Section 5.2).
- Existing behavior — action items, chunking for long transcripts, `renderNotes()`'s general shape — is preserved; this is additive.

### Non-Goals
- Obsidian vault sync for recording notes — deferred to Phase 2 (#60), governed by the linked ADR.
- Fetching external sources (web search, citations to specific papers/books beyond what's in `ProjectField` book entries already used for `buildTranscriptionPrompt`) — permanent non-goal; "going outside the course" is limited to the model's own knowledge, stated as optional.
- Editing/regenerating notes for already-`DONE` recordings — `canRetry()` still refuses `DONE` status (`recordings.ts:68`); no change to that behavior in this phase. If a future "regenerate a DONE recording" action is added, it is separate work, not covered here.
- Cross-project connections (linking two different courses' recordings) — only same-`projectId` context is considered.

## 3. System Overview

### Main Components
1. `buildCourseContext()` (new, `src/lib/recordings.ts`) — fetches prior same-project recordings' summaries, bounded and formatted as LLM context.
2. `summarizeTranscript()` (modified) — extended `NotesSchema` and `shapeHint`, extended `NOTES_SYSTEM` prompt, now accepts course context, validates `connections[].sourceTitle` before rendering.
3. `renderNotes()` (modified) — renders `clarifications`/`connections` as Obsidian callouts appended after key points.
4. `processRecording()` (modified) — calls `buildCourseContext()` and threads it through to `summarizeTranscript()`.

### Abstraction Levels/Layers
- **Data layer**: Prisma `Recording` model — unchanged (Section 4).
- **Generation layer**: `recordings.ts` — prompt construction, LLM call, rendering. All changes are here.
- **Presentation layer**: `src/lib/markdown.ts`'s `renderMarkdown()` — unchanged; consumes whatever `renderNotes()` produces.

### External Dependencies
- `callAiForJson()` (`src/lib/aiClient.ts`) — unchanged interface, same Claude-or-local-model routing already used.
- `marked` (via `markdown.ts`) — renders the final markdown in-app; does not understand Obsidian callout syntax (Section 8).

## 4. Core Domain Model

No schema changes. `Recording.summary` (String?) remains the single markdown string persisted and synced; the richer structure is composed within that string by `renderNotes()`, not stored as separate fields.

**Normalization Rules:** none beyond what exists — `clarifications`/`connections` are ephemeral (schema-validated via Zod, immediately rendered into markdown, then discarded); nothing new is compared or deduplicated across recordings.

## 5. Subsystem Specifications

### 5.1 Extended `NotesSchema`

**Intent:** Traces to the ADR Context's Outcomes ("clarifies confusing passages and connects... within the same course") — this is the schema the LLM's output is validated against, so it's the contract for what "clarify and connect" concretely means.

```ts
const NotesSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  clarifications: z.array(z.object({
    term: z.string(),
    explanation: z.string(),
  })),
  connections: z.array(z.object({
    // Must exactly match one of the `title` values given in the course
    // context (Section 5.2) — null only for the `external: true` case,
    // where by definition there is no prior recording to name.
    sourceTitle: z.string().nullable(),
    note: z.string(),
    // Optional external aside — Non-Goal boundary applies: no citation
    // beyond what the model already knows, never a fabricated source.
    external: z.boolean().default(false),
  })),
  actionItems: z.array(z.object({ title: z.string(), dueDate: z.string().nullable() })),
});
```

- `clarifications`: terms/acronyms the transcript uses but doesn't define. Empty array is the expected common case for a straightforward lecture — the model is instructed not to invent jargon that isn't actually in the transcript.
- `connections`: one entry per genuine link to a prior recording's stored notes for the same project. `sourceTitle` names which prior recording it connects to (must match one of the titles given in the course context — Section 5.4 defines the validation), making the connection attributable rather than a floating unverifiable claim, and giving Phase 2 something concrete to eventually link to. `note` states the connection in prose (e.g. "This builds on last week's discussion of X"); `external` is `true` only for an aside that goes beyond the course, in which case `sourceTitle` is `null` (Goals: optional, never required). Empty array is expected when no course context was available (no `projectId`, or no prior `DONE` recordings) or when nothing genuinely connects.

### 5.2 `buildCourseContext()`

**Intent:** Traces to the Outcomes' "connect... within the same course" — this is the retrieval step that makes those connections possible at all; without prior notes as context, the model has nothing to connect to.

```ts
async function buildCourseContext(
  projectId: string | null,
  excludeRecordingId: string,
): Promise<string | null>
```

- Returns `null` immediately if `projectId` is `null` (no course to connect within).
- Queries up to the **3 most recent** `DONE` recordings for the same `projectId`, excluding the current recording, ordered by `createdAt` descending, selecting only `title` and `summary`.
- For each recording, strips its own AI-added callout blocks before use as context: takes only the substring of `summary` before the first occurrence of `"\n\n> [!"` (i.e. everything up to, but not including, its Key points/Clarifications/Connections callouts — see Section 5.5's fixed section order, so this split point is deterministic). This prevents a later recording's context from being built out of an earlier recording's own clarifications/connections (compounding) or its callout markup syntax.
- Each stripped summary is then bounded to **1800 characters** individually via `clip()` (`recordings.ts:137-143`) — `clip()` calls `collapse()`, which flattens whitespace/newlines, so this per-recording cap is applied to each summary *before* assembling the block below, never to the joined multi-recording string (joining and *then* collapsing would erase the `### <title>` delimiters the model needs to tell recordings apart).
- Formats each surviving recording as `"### <title>\n<clipped summary>"`, joined by `\n\n`, where `<title>` is the recording's `title` with internal whitespace (including any newline) collapsed via the same `collapse()` helper (`recordings.ts:134-136`ish) applied to the title alone, not the summary — this guarantees the header stays a single line regardless of what's in `title`. With 3 recordings at 1800 chars each plus headers, the practical ceiling is well under 6000 characters — no separate combined-length truncation is applied on top, since capping per-recording already bounds the total. If every recording's summary is empty after stripping, returns `null`.
- Never queries or includes recordings the transcript-in-progress hasn't finished — only `DONE` status, matching how `summary` is only ever populated (Section 2, Non-Goals).

### 5.3 Extended `NOTES_SYSTEM` prompt

**Intent:** Traces to the ADR Context's Failure-of-success analysis — the prompt is the actual guardrail against hallucinated connections, so its wording is the load-bearing artifact, not an implementation detail to gloss over.

Appended to the existing `NOTES_SYSTEM` string (verbatim additions, in order):

```
Additionally:
- `clarifications`: for any jargon, acronym, or term the transcript uses without defining, add a plain-language explanation. Only include terms that actually appear in the transcript — never introduce a term the transcript didn't use. Empty array if nothing needs clarifying.
- `connections`: you may be given notes from earlier recordings in the same course, below. For each genuine conceptual link between this lecture and one of those, add an entry naming what specifically connects them — never a vague "this relates to earlier material." If no course context is given, or nothing genuinely connects, return an empty array. Do not fabricate a connection to sound thorough.
- Optionally, and only if a connection to something outside the provided course context is obvious and directly relevant (a well-known related concept, not a specific citation), you may add one such entry with `external: true`. This is secondary to the within-course connections above and should be rare.
```

When `buildCourseContext()` returns non-null, its content is appended to the **system** string — the same placement `glossary` already uses today (`recordings.ts:257-259`: `` `${NOTES_SYSTEM} Context for this recording: ${glossary}...` ``), not the user content. Course context is guidance for interpreting the transcript, exactly like the glossary is; the transcript itself is the only thing ever passed as user content (`chunks[i]`, or the whole transcript for a single-chunk recording), so this placement is what keeps "what was said in this recording" (user content) separate from "background the model was given" (system) — never a question of user-vs-system generically, only of never blending context into the transcript string itself. Appended under this exact heading: `" Prior recordings in this course, for context only: <context>"`.

`shapeHint` (`recordings.ts:260-261`, passed to `callAiForJson()` alongside `NotesSchema` to steer the model's raw JSON output) must be updated in the same change to include the two new fields — leaving it as today's `'{"summary": string, "keyPoints": [...], "actionItems": [...]}'` would steer the model toward the old shape while the Zod schema demands the new one, and every call would fail schema validation. New value:
```
'{"summary": string, "keyPoints": [string, ...], "clarifications": [{"term": string, "explanation": string}, ...], "connections": [{"sourceTitle": string|null, "note": string, "external": boolean}, ...], "actionItems": [{"title": string, "dueDate": string|null}, ...]}'
```

### 5.4 `connections[].sourceTitle` validation

**Intent:** Traces directly to the ADR's Failure-of-success concern about hallucinated connections — an unattributable connection can't be checked by a human or, later, linked by Phase 2, so this validation is what makes "genuine link" more than a claim in prose.

After every `callAiForJson()` call that returns `connections` — the single-call path, each per-chunk call, and the combine-pass call alike (Section 5.5.1) — and before that result's `connections` are used for anything downstream: for each entry where `external` is `false`, verify `sourceTitle` exactly matches one of the titles passed into that call's course-context (Section 5.2). An entry that fails this check (a title that doesn't match — including `null` when `external` is `false`) is dropped from the array; this is not a call failure (Section 6, Failure Class 1 does not apply), it is treated as one invalid item among otherwise-valid output, filtered the same way `renderNotes()` already filters an empty `keyPoints`/`clarifications`/`connections` entry (Section 5.5) — dropped silently, not retried, not fatal to the call.

Recording titles are not guaranteed unique (`createRecording` defaults an untitled upload to `"Untitled recording"` — two prior recordings can share that title); a `sourceTitle` match against a duplicated title is accepted as attributable to "one of the recordings with that title," not a specific one — acceptable for this phase since Phase 2 has no per-recording linking yet (Section 2, Non-Goals). A title containing a newline would break the one-line `### <title>` header `buildCourseContext()` emits (Section 5.2); `buildCourseContext()` collapses internal whitespace in each title (not the summary body) before using it as a header, so this can't occur.

### 5.5 `renderNotes()` — callout rendering

**Intent:** Traces to the Outcomes' "richer... formatting" and the Failure-of-success concern about distinguishing AI-added content from the transcript-derived summary.

```ts
function renderNotes(data: z.infer<typeof NotesSchema>): string {
  const parts = [data.summary.trim()];

  const points = data.keyPoints.filter((p) => p.trim());
  if (points.length > 0) {
    parts.push(`## Key points\n\n${points.map((p) => `- ${p}`).join("\n")}`);
  }

  const clarifications = data.clarifications.filter((c) => c.term.trim() && c.explanation.trim());
  if (clarifications.length > 0) {
    const body = clarifications.map((c) => `> **${c.term}**: ${c.explanation}`).join("\n> \n");
    parts.push(`> [!info]- Clarifications\n${body}`);
  }

  const connections = data.connections.filter((c) => c.note.trim());
  if (connections.length > 0) {
    const body = connections
      .map((c) => (c.external ? `> 🔭 ${c.note}` : `> **${c.sourceTitle}**: ${c.note}`))
      .join("\n> \n");
    parts.push(`> [!note]- Connections\n${body}`);
  }

  return parts.join("\n\n");
}
```

- Callout blocks use the `-` foldable-collapsed marker (`[!info]-`) so they render collapsed by default in Obsidian, keeping the core summary the primary reading surface.
- Order is fixed: summary, key points, clarifications, connections — matches reading order (grasp the content, then the added context).

### 5.5.1 Multi-chunk merge behavior

**Intent:** Traces to the same Failure-of-success concern as Section 5.4 — today's chunked path already has a rule for not losing `actionItems` across the merge (`recordings.ts:296-307`); without an equivalent rule, `clarifications`/`connections` gathered in earlier chunks would be silently discarded when only the final combine call's output is used, contradicting the Goals' "additionally returns" (Section 2).

For a chunked (multi-part) transcript, `summarizeTranscript()` today: calls the model once per chunk, `renderNotes()`s each chunk's result into `partials`, accumulates only `actionItems` across chunks (`actionItems.push(...result.data.actionItems)`), joins `partials` as the combine call's input, then makes one more combine call whose own `actionItems` are unioned and deduplicated with the accumulated ones (`recordings.ts:300-307`). This phase adds the equivalent accumulation for `clarifications` and `connections`, following the same pattern:

- Accumulate `clarifications` and `connections` from every per-chunk result the same way `actionItems` is accumulated (push onto a running array per chunk).
- Run the Section 5.4 `sourceTitle` validation on each chunk's `connections` immediately after that chunk's call, before accumulating — a chunk only sees the same course context every other chunk does (Section 5.2's result, computed once), so the same title list validates every chunk's output.
- The combine call's own `clarifications`/`connections` (from its `NotesSchema` result) are unioned with the accumulated ones, then deduplicated: `clarifications` by `term.trim().toLowerCase()` (same normalization `actionItems` already uses on `title`, `recordings.ts:303`), `connections` by `sourceTitle` (or, for `external: true` entries, by `note.trim().toLowerCase()`, since there's no `sourceTitle` to key on).
- The combine call's own `connections` are also validated against the course-context titles (Section 5.4) before this union — the combine pass receives the same course-context system string as every other call.
- `renderNotes()` is called exactly once on the final, merged `{summary: combined.data.summary, keyPoints: combined.data.keyPoints, clarifications: <merged>, connections: <merged>, actionItems: <merged>}` — never on a per-chunk partial's raw clarifications/connections directly (those exist only to be accumulated into the final merge, same as `actionItems` already works).

## 6. Failure Model

### Failure Classes
1. **LLM call failure** (existing) — `callAiForJson()` returns `{ok: false}` whenever the model's output fails `NotesSchema.safeParse()` (`aiClient.ts:185`) — there is no retry inside `callAiForJson()` itself, this is a single attempt. Unchanged: `summarizeTranscript()` returns the same error shape; `processRecording()` marks the recording `FAILED` with the error message, transcript already persisted. The schema extension enlarges the surface a model can fail to satisfy (five top-level fields instead of three) but introduces no new failure *class* — it's the same shape-mismatch-means-`FAILED` behavior as today, just failable in more ways. Recovery is the existing manual `retryRecordingAction()`, same as any other `FAILED` recording.
2. **`buildCourseContext()` failure** — a Prisma query failure while fetching prior recordings. Not caught separately: it propagates up through `processRecording()`'s existing top-level `try/catch` (`recordings.ts:387-390`), which already marks the recording `FAILED` with the caught error's message. No new recovery behavior needed — this reuses the existing catch-all.

### Recovery Behavior
- Chunked (multi-part) transcripts: `buildCourseContext()` is called once per recording (not once per chunk) and its result is appended to every chunk's system prompt identically, same as `contextPrompt` (the transcription glossary) is today (Section 5.3). Merging `clarifications`/`connections` across chunks and the combine pass follows Section 5.5.1.
- A recording with no `projectId`, or whose project has no prior `DONE` recordings, proceeds exactly as today except `connections` is always empty — not a failure, not logged as one.

### Restart Recovery
No change — `processRecording()`'s existing stuck-row handling (`STUCK_AFTER_MS`, `canRetry()`) is untouched; this phase adds no new persistent state to recover.

## 7. Security

**Trust Boundary:** No new trust boundary — `buildCourseContext()` reads only the current user's own recordings (scoped by `projectId`, which is already scoped to the user's own projects via existing ownership checks in `processRecording()`'s callers). No new external input is introduced; course context comes from the same database the rest of the pipeline already trusts.

**Secret Handling:** No new secrets. Uses the same `aiConfigFromSettings()` path as today.

## 8. Known Limitation — Callout Rendering In-App

`marked` (via `src/lib/markdown.ts`) does not understand Obsidian's `> [!type]` callout syntax — it renders the block as a plain blockquote, with the literal text `[!info]- Clarifications` visible as the first line, followed by the clarification bullets as blockquote content. This is a readability degradation, not a rendering error: the content is fully present and legible, just without Obsidian's colored/collapsible callout chrome. Accepted for Phase 1 per the ADR's Failure-of-success analysis — worth revisiting only if in-app note review turns out to be the primary reading surface (currently Obsidian is expected to be, once Phase 2 ships).

## 9. Amendment — Timestamped Transcripts

Added after initial implementation, at the user's direct request: `transcribeAudio()` (`src/lib/transcribe.ts`) now formats `Recording.transcript` as one `[h:mm:ss] <segment text>` line per Whisper `verbose_json` segment (via the new `formatTimestampedTranscript()`), instead of the flat prose string. Falls back to the original flat text when the endpoint's response has no usable `segments` array (a server that only implements plain `{text}` verbose_json). Out of scope for this amendment: no change to `summarizeTranscript()`'s prompt to explicitly instruct citing timestamps in `clarifications`/`connections` — the transcript the model sees now happens to carry them inline, which it may reference naturally, but this isn't a required behavior and isn't tested for. Unit tests in `src/lib/transcribe.test.ts`.

## 10. Test and Validation Matrix

**Core Conformance**
- `buildCourseContext()` returns `null` when `projectId` is `null`.
- `buildCourseContext()` returns `null` when `projectId` is set but no other `DONE` recording exists for it.
- `buildCourseContext()` excludes the current recording even if it is (implausibly) `DONE` already.
- `buildCourseContext()` strips a prior recording's callout blocks (content after `"\n\n> [!"`) before including it in context.
- `buildCourseContext()` caps each individual recording's stripped summary at 1800 characters, preserving the `### <title>` header and newline structure between recordings (not one flattened joined-then-clipped string).
- The `connections[].sourceTitle` validation (Section 5.4) drops an entry whose `sourceTitle` doesn't match any title in the course context; keeps one that matches exactly.
- The `connections[].sourceTitle` validation drops an `external: false` entry with `sourceTitle: null`.
- `renderNotes()` omits the Clarifications callout entirely when `clarifications` is empty (no empty `> [!info]-` block emitted).
- `renderNotes()` omits the Connections callout entirely when `connections` is empty.
- `renderNotes()` renders both callouts, in fixed order, when both are non-empty.
- `renderNotes()` marks an `external: true` connection with the 🔭 prefix and no `sourceTitle`; a non-external entry renders its `sourceTitle` in bold.
- `NotesSchema` rejects a payload missing `clarifications` or `connections` (schema is not optional-by-omission — a call that fails validation returns `{ok: false}` and the recording is marked `FAILED`, per Failure Class 1; there is no retry inside the call itself).
- `shapeHint` (Section 5.3) includes all five top-level fields — a call using the old three-field hint against the new schema is exactly the regression this test guards against.
- Multi-chunk merge (Section 5.5.1): `clarifications`/`connections` from an earlier chunk survive into the final merged result even when the combine call's own output doesn't repeat them (mirrors the existing `actionItems` accumulation test this file already needs).
- Multi-chunk merge: a `connections` entry appearing in two different chunks (same `sourceTitle`) is deduplicated to one entry in the final result.

**Real Integration**
- One real recording, from a project with at least one prior `DONE` recording, produces non-empty `connections` whose `sourceTitle` is checked mechanically (every non-`external` `sourceTitle` is asserted to match one of the prior recordings' actual titles — this is objectively falsifiable, unlike judging the connection's substance); the *content* of `note` (whether the connection is actually a good one) is manually reviewed.
- One real recording containing at least one undefined acronym/jargon term produces a corresponding `clarifications` entry; every `clarifications[].term` is asserted (case-insensitive substring) to actually appear in the transcript — objectively falsifiable per Section 5.3's own rule.

## 11. Implementation Checklist

**Core Conformance**
- [x] `buildCourseContext()` implemented per Section 5.2 (per-recording clip, callout-stripped, header-preserving join) — extracted as a pure `formatCourseContextEntry()` helper plus the Prisma fetch, so the formatting logic is unit-testable without a database.
- [x] `NotesSchema` extended per Section 5.1 (including `sourceTitle`).
- [x] `NOTES_SYSTEM` extended per Section 5.3.
- [x] `shapeHint` (now `NOTES_SHAPE_HINT`) updated per Section 5.3 to include `clarifications` and `connections`.
- [x] `connections[].sourceTitle` validation implemented per Section 5.4 as `validateConnections()`.
- [x] `renderNotes()` extended per Section 5.5.
- [x] Multi-chunk accumulation/dedup for `clarifications`/`connections` implemented per Section 5.5.1.
- [x] `processRecording()` threads `buildCourseContext()`'s result into `summarizeTranscript()`.
- [x] Unit tests per Section 10's Core Conformance list added to `recordings.test.ts` and `transcribe.test.ts`: `formatCourseContextEntry`, `validateConnections`, `renderNotes`, `dedupeClarifications`/`dedupeConnections` (extracted from inline merge logic so the Section 5.5.1 dedup rules are directly testable), `NotesSchema`/`NOTES_SHAPE_HINT` five-field regression guards, `formatTimestampedTranscript`. All 18 suite files pass, `tsc --noEmit` clean, production build succeeds. Verified across three rounds of independent adversarial (Fable) code review — each round's findings fixed and re-verified; final verdict READY.

**Operational Validation**
- [ ] Run against one real lecture recording with prior course history; mechanically check `sourceTitle`/`clarifications[].term` per Section 10, and manually review connection/clarification *quality* before considering Phase 1 done (Discovery's named uncertainty-reduction step). Not done — needs a real recording and a human to judge quality, not something to run unattended.

**Recommended Extensions** (not required for this phase)
- Configurable course-context recording count / per-recording character budget (currently fixed at 3 recordings / 1800 chars each, Section 5.2) — only worth it if the fixed defaults prove wrong in practice. No issue filed; revisit if Operational Validation surfaces a problem.
- Obsidian vault sync for recording notes — Phase 2, tracked in #60, governed by the linked ADR.
