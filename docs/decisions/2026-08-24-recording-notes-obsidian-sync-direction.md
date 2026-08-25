# ADR: Recording Notes Obsidian Sync Direction

## ADR Author/s

Claude (session), with Justin

## Update Date

2026-08-24

## Status

Proposed

## Who should be notified of ADR changes?

@JustinChaney2023

## Context

### Problem

Justin (sole user/student, using Marvis Calendar to record his own lectures) gets lecture notes today from `processRecording()` → `summarizeTranscript()` in `src/lib/recordings.ts`: transcript → LLM → `{summary (markdown), keyPoints, actionItems}`, stored on `Recording.summary`. Generation is deliberately conservative — it restates only what's in the transcript, never invents content. This is insufficient two ways: the output format is flat (headings + bullets only), and it's transcript-bound (never clarifies jargon or connects ideas across a course). Recording notes also have no path into Obsidian today — only Project and Task notes sync, via the existing `marvis-obsidian` plugin's two-way pull/push commands (`main.ts:65-78`).

### Outcomes

Notes should be genuinely useful to reread and build on: richer Obsidian-flavored markdown, plus content that clarifies confusing passages and connects a lecture's ideas to others within the same course (going outside the course is allowed, not required). Recording notes should land in the vault as their own synced artifact, the same tier-3 pattern (PersonalAccessToken auth, plugin pull) already proven for Projects/Tasks. Decision Quality Test: makes "does this actually help me study/retain" **possible** to answer; makes connecting a lecture's ideas to the rest of the course **easier**.

### Impact & opportunity cost

Nothing breaks if this doesn't ship — recordings already produce usable, flat notes today. Cost of inaction is ongoing manual work (rereading, connecting concepts by hand) every time Justin studies from a recording. Single-user personal-productivity feature; opportunity cost is only Justin's own time against the rest of the backlog (#20, Whisper GPU, markitdown).

### Constraints

- **Technical**: PersonalAccessToken + v1 REST API already exist (Fixed, from Obsidian Phase 1, `src/lib/apiAuth.ts`). Vault folder convention (`08 AI Workspace/`, etc.) already established (Fixed). "Connect within course" needs prior notes/recordings for the same Project as LLM context — not built today (Negotiable).
- **Financial**: added LLM tokens per recording for richer generation — same self-hosted-or-Claude cost model already in place, no new integration (Negotiable).
- **Organizational**: single developer/user (Fixed).
- Not applicable: Operational (no support burden — personal tool); Timeline (no deadline stated).

### Evidence & Confidence

- "when recording a lecture i want it to format the notes using md or wtv else it can... make it easy to understand and even expand upon the professors ideas" — Reported, source: user message, this session.
- "Sync to vault now... event and task notes can stay in app" — Reported, source: user's Discovery answer, this session.
- Task/Project notes already two-way sync today, and pull already refuses to overwrite a locally-edited note: it compares a stored `marvis_synced_hash` against the note's current content and skips with a Notice ("local changes haven't been pushed yet") rather than clobbering it — Observed, source: `marvis-obsidian/main.ts:161-167` (`pullProjects`), `main.ts:247-252` (`pullTasks`), read this session.
- `canRetry()` returns `false` whenever `status === "DONE"` (`src/lib/recordings.ts:68`), and `Recording.summary` is only ever written in the same update that sets `status: "DONE"` (`recordings.ts:378-386`) — so `retryRecordingAction()` can **never** run against a recording that already has notes, and cannot overwrite `Recording.summary` today. (An earlier draft of this ADR claimed the opposite; corrected after adversarial review caught the discrepancy against the actual code.) — Observed, source: `src/lib/recordings.ts:68,378-386,495-509`, read this session.
- Discovery's Phase 1 changes the notes-generation prompt going forward; existing DONE recordings only get the improved format if something regenerates them. No such "regenerate a DONE recording" action exists today, but it is a plausible near-term follow-up once Phase 1 ships — forward-looking, Assumed, not treated as load-bearing here (Phase 2's sync design does not depend on it existing).
- Problem Confidence: **Medium** — per the mechanical rule, no load-bearing claim here is Assumed-and-unaccepted (rule 1 doesn't fire) and none is Measured or two-independent-Observed (rule 2 doesn't fire), so rule 3 applies: Medium.
- Uncertainty-reduction step: Phase 1 (richer generation, tested against one real recording) ships and is reviewed before Phase 2's vault-sync architecture is built — cheap, reuses today's pipeline.

### Phasing

- **Phase 1** — upgrade `summarizeTranscript()`'s prompt/output for richer Obsidian-flavored markdown and controlled expansion (clarify + within-course connections). Ships to `dev` alone, testable against a real recording immediately.
- **Phase 2** — expose recording notes via the v1 API and add a pull-only sync command to `marvis-obsidian`, landing in a new vault folder (this ADR's decision governs Phase 2's sync direction).

### Failure-of-success analysis

Expansion could hallucinate connections that sound plausible but are wrong — mitigated by scoping to "clarify + within-course" rather than open-ended (tracked in the Phase 1 spec, not this ADR). Richer markdown could render badly in-app if Obsidian-specific syntax (callouts) isn't supported by `src/lib/markdown.ts`'s `renderMarkdown()` — also a Phase 1 spec concern.

## Decision

Recording notes sync **one-way**: the calendar app generates notes, Phase 2 exposes them read-only over the v1 API, and the `marvis-obsidian` plugin only ever pulls them into the vault, reusing the same `marvis_synced_hash` guard `pullProjects`/`pullTasks` already use — a pull skips (with a Notice) instead of overwriting a note that was edited locally since the last sync. There is no push path for recording notes.

The decisive fact isn't a retry conflict — `canRetry()` (`recordings.ts:68`) already makes that impossible, since it refuses to run against any `DONE` recording, and `Recording.summary` is never written outside the transition into `DONE`. The decision instead comes from Discovery's own scope: the user asked for recording notes to land in the vault, not to be editable from the vault (Context, Outcomes) — unlike Project notes, which are purely human-authored and were always meant to be written in either place. Building a push endpoint for content nobody asked to edit in Obsidian is unrequested scope for Phase 2. Reusing the existing hash-guard costs nothing (it's the same code path Projects/Tasks already exercise) and removes the one real risk a naive one-way pull would carry: silently overwriting something the user separately noted in the vault copy.

## Discarded alternatives

- **Two-way sync (same pattern as Project/Task notes)** — plugin pull/push, edits in Obsidian pushed back to `Recording.summary`. Discarded: nothing in Discovery asked for editing recording notes from Obsidian (unlike Project notes, which are human-authored either way); adding a push endpoint and its API surface is speculative scope against no stated need.
- **Pull once on `DONE`, never re-pull** — freeze the vault copy the moment it's first synced. Discarded: goes stale with no self-healing path if a future "regenerate notes" action is ever added to `canRetry`'s scope, and the hash-guard approach costs nothing extra while staying safe to re-run indefinitely.

## Consequences

### Positive

- Reuses proven code (`marvis_synced_hash` compare-and-skip) instead of inventing new conflict handling — no new failure mode for `marvis-obsidian` to carry.
- `retryRecordingAction()` is unaffected either way; this decision doesn't touch it.
- Vault copy stays safely re-pullable: a locally-edited note is skipped, not clobbered, same guarantee Project/Task notes already give.

### Negative

- Justin cannot annotate/extend a recording's notes directly in the Obsidian copy and have that stick — a local edit just means the next pull skips that note instead of updating it, so the vault copy can go stale until the note is manually reconciled. (Project notes remain the right place for anything meant to be edited.)
- Follow-up: if in-Obsidian annotation of recording notes turns out to matter in practice, that's new design work, not covered here. Tracked in #60.

## Spec

- Spec: [docs/specs/2026-08-24-recording-notes-phase-1-generation.md](../specs/2026-08-24-recording-notes-phase-1-generation.md) (Phase 1)
- Spec: [docs/specs/2026-08-24-recording-notes-phase-2-obsidian-sync.md](../specs/2026-08-24-recording-notes-phase-2-obsidian-sync.md) (Phase 2) — written before Phase 1's real-recording Operational Validation completed (blocked on a Whisper endpoint being connected), since the sync mechanism itself doesn't depend on note quality. Phase 2's own Operational Validation still depends on real synced notes existing.

## References

- Related docs: `calendar/docs/motion-feature-backlog.md` (Recording model, recorder UI origin), GitHub issue #60.
- Implementation: `calendar/src/lib/recordings.ts`, `marvis-obsidian/main.ts`.

> **Approval** is not recorded in this document. A non-author must review the ADR before it moves to "Accepted"; a non-author's approval of the PR that carries the ADR **is** that approval.
