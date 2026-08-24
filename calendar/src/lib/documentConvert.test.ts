import assert from "node:assert/strict";
import {
  IMPORT_FILE_ACCEPT,
  MAX_CONVERT_BYTES,
  isWithinSizeLimit,
  pickConverter,
} from "./documentConvert";

// Routing: the whole point is that a .docx never needs the service and a
// .pdf always does. Getting either wrong is a silent regression — .docx
// falling through to markitdown would break offline imports that work today.
assert.equal(pickConverter("syllabus.txt"), "text");
assert.equal(pickConverter("syllabus.md"), "text");
assert.equal(pickConverter("syllabus.markdown"), "text");
assert.equal(pickConverter("syllabus.docx"), "docx");
assert.equal(pickConverter("syllabus.pdf"), "markitdown");
assert.equal(pickConverter("slides.pptx"), "markitdown");
assert.equal(pickConverter("grades.xlsx"), "markitdown");
assert.equal(pickConverter("scan.png"), "markitdown");
assert.equal(pickConverter("legacy.doc"), "markitdown");

// Case and multi-dot names both show up in real uploads.
assert.equal(pickConverter("SYLLABUS.PDF"), "markitdown");
assert.equal(pickConverter("BIO 101 - Syllabus.v2.FINAL.docx"), "docx");

// Unsupported must be null, not a wrong guess — .zip and audio are
// deliberately excluded rather than silently routed somewhere.
assert.equal(pickConverter("archive.zip"), null);
assert.equal(pickConverter("lecture.mp3"), null);
assert.equal(pickConverter("noextension"), null);
assert.equal(pickConverter(""), null);

// ".pdf" as a substring, not a suffix, must not match.
assert.equal(pickConverter("my.pdf.exe"), null);

// Size limits: zero-byte is as invalid as oversized.
assert.equal(isWithinSizeLimit(1), true);
assert.equal(isWithinSizeLimit(MAX_CONVERT_BYTES), true);
assert.equal(isWithinSizeLimit(MAX_CONVERT_BYTES + 1), false);
assert.equal(isWithinSizeLimit(0), false);

// The file input must actually offer every format we can handle, or the
// user has to fight the picker to select a file that would have worked.
for (const ext of [".txt", ".docx", ".pdf", ".pptx", ".png"]) {
  assert.ok(IMPORT_FILE_ACCEPT.includes(ext), `accept missing ${ext}`);
}

console.log("documentConvert.test.ts: all checks passed");
