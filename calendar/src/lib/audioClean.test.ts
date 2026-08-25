import assert from "node:assert/strict";
import { cleanAudioForTranscription } from "./audioClean";

// This machine's dev environment has no ffmpeg installed, which is
// actually the more important path to cover: the fallback must be silent
// and never throw, since processRecording has no other guard around it.
async function main() {
  const traversal = await cleanAudioForTranscription("user123", "../../etc/passwd");
  assert.equal(traversal, null);

  const missingFile = await cleanAudioForTranscription("user123", "user123/does-not-exist.mp3");
  assert.equal(missingFile, null);

  console.log("audioClean.test.ts: all checks passed");
}

main();
