import assert from "node:assert/strict";
import { LOCAL_TO_GOOGLE_COLOR } from "./google-sync";
import { PROJECT_EVENT_COLORS } from "./eventColors";

// Every user-selectable event color must have a Google Calendar colorId to
// export to — an unmapped color silently drops on export (colorId becomes
// undefined) and round-trips to a different color on the next import.
for (const key of Object.keys(PROJECT_EVENT_COLORS)) {
  assert.ok(
    LOCAL_TO_GOOGLE_COLOR[key],
    `LOCAL_TO_GOOGLE_COLOR is missing an entry for "${key}" (present in PROJECT_EVENT_COLORS)`,
  );
}

console.log("google-sync.test.ts: all checks passed");
