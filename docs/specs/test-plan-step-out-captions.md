# Manual test plan — local live captions + step-out summary (#62) + timestamped questions (#63)

One-time setup, then a `/recordings` walkthrough. Nothing here is automated (browser mic + WASM model, can't run headless) — this is what to click through by hand.

## Setup (once)

1. `cd calendar && npm install` (pulls the new `@huggingface/transformers` dependency).
2. `npm run setup:whisper` — downloads the local whisper model (~40MB) into `calendar/public/models/` and copies ONNX runtime WASM into `calendar/public/ort/`. Confirm it prints "Local-whisper assets ready." with no errors.
3. A Prisma migration added `Recording.questions` (`prisma/migrations/20260825084302_add_recording_questions`) — if you've already got `next dev` running from before this change, restart it so it picks up the regenerated Prisma client, or you may see errors about an unknown `questions` column.
4. `npm run dev`, log in, go to `/recordings`.

## Test 1 — captions load and don't break normal recording

1. Click **Start recording**, allow mic access.
2. Open the browser console — confirm **no CSP violation errors** (look for `Refused to ...` / `Content-Security-Policy` messages). This is the main risk: the new `worker-src`/`wasm-unsafe-eval` CSP additions either work or loudly don't.
3. Watch for "Loading local captions…" under the recording indicator, then within ~10-15s of talking, a rolling caption line should appear and update every ~8 seconds.
4. Say a distinctive phrase (a specific name, a number) and confirm the caption is a plausible rough transcription of it — doesn't need to be perfect, just recognizably related.
5. Click **Stop & transcribe**. Confirm the recording still uploads and appears in the list below as normal (this path is untouched — just confirming nothing regressed).
6. Once the recording finishes processing, open it and check the **real transcript** matches what was actually said — the local captions must have no effect on this.

## Test 2 — step out / I'm back

1. Start a new recording, talk for ~10s so captions have started.
2. Click **Step out**. Confirm the button label flips to **I'm back**, and a small amber note appears ("Stepped out at 0:1x…").
3. Talk for another 15-20 seconds — say something clearly identifiable (e.g. "the meeting is moved to Thursday, bring the budget doc").
4. Click **I'm back**.
5. Confirm a "Summarizing what you missed…" indicator appears, then within a few seconds an indigo summary panel shows a short catch-up note reflecting roughly what was said in that window (doesn't need to be verbatim — check it's not empty, not generic, and not about the wrong window).
6. Click the **×** on the summary panel — confirm it dismisses.
7. Stop the recording normally — confirm the step-out summary is **not** saved anywhere on the recording (check the recording detail view has no trace of it — it's meant to be ephemeral).

## Test 3 — edge cases

1. **Step out with nothing said**: click Step out, wait silently 3-4 seconds, click I'm back — should show a message like "Not enough was captured to summarize," not a crash or an empty panel.
2. **Step out twice in a row**: click Step out, then Step out again before clicking I'm back — second click should still just toggle back to the "I'm back" label state (no double-counted window). Not critical if this feels a little off, just note what happens.
3. **No mic captions available**: temporarily rename/move `calendar/public/models/` (simulate not having run setup) and restart the recording — should show "Local captions unavailable — run `npm run setup:whisper`..." instead of erroring, and Start/Stop/Pause/Resume/Stop & transcribe should all still work normally (captioning failure must never block the real recording/upload path). Undo the rename afterward.
4. **Pause during captioning**: Pause, then Resume — captions don't need to keep working perfectly through a pause, just confirm pausing/resuming still works and nothing crashes.

## Test 4 — timestamped questions (#63)

1. Start a new recording. While it's running, type a question into the new "Type a question…" box (e.g. "what did they just say about the deadline?") right after actually saying something deadline-related, and click **Ask** (or press Enter).
2. Confirm it appears in a small list under the input, prefixed with its timestamp (e.g. `[0:14] what did they just say about the deadline?`).
3. Ask 1-2 more questions at different points, then **Stop & transcribe**.
4. Once the recording finishes processing (status flips to done in the list), open its detail panel — a **"Questions asked during recording"** box should appear above the transcript, showing each question with either a real answer or "Answer pending…" (pending should be brief/rare — answers are filled in before summarization runs, so they should be there by the time status is DONE).
5. Sanity-check one answer against what you actually said around that timestamp — it should be relevant to that specific moment, not a generic restatement of the whole recording.
6. **No questions asked**: record something with the box left empty the whole time — confirm no "Questions asked" section appears at all (not an empty one).
7. **Transcription backend without segments**: if your configured whisper endpoint doesn't return per-segment timestamps (check Settings → AI), questions should still get answered — just using the whole transcript as context instead of a windowed excerpt. Not critical to test unless you know your endpoint lacks segment support.

## What to report back

For each test: pass / fail, and for any fail — what you saw (console errors, wrong summary content, UI stuck, etc.) plus which step. Screenshots of any console errors are the most useful thing if something's off with the CSP/worker setup, since that's the part most likely to be sensitive to your actual browser/OS.
