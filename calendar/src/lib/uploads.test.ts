import assert from "node:assert/strict";
import path from "node:path";
import { contentTypeFor, ownsUploadPath, resolveUploadPath, UPLOADS_ROOT } from "./uploads";

// --- Path traversal ---
// This function guards a route that reads an arbitrary user-supplied
// path off disk, so every escape attempt below is the actual attack,
// not a hypothetical.

// The happy path still has to work, or the guard is useless.
const ok = resolveUploadPath("user123/abc-def.png");
assert.equal(ok, path.join(UPLOADS_ROOT, "user123", "abc-def.png"));

// Classic relative traversal.
assert.equal(resolveUploadPath("../../etc/passwd"), null);
assert.equal(resolveUploadPath("user123/../../../etc/passwd"), null);

// An absolute path WINS over the base in path.resolve — checking only
// for ".." would sail straight past this one.
assert.equal(resolveUploadPath("/etc/passwd"), null);

// A sibling directory sharing the root's name prefix must not satisfy a
// bare startsWith(UPLOADS_ROOT): "var/uploads-evil" is not "var/uploads".
// Reached via traversal, since a bare relative name can't escape.
assert.equal(resolveUploadPath("../uploads-evil/secret.png"), null);

// NUL truncation: some syscalls stop at \0, so a name that looks safe to
// a JS string check can address a different file once it hits the OS.
assert.equal(resolveUploadPath("user123/ok.png\0.txt"), null);

// Empty/garbage input shouldn't resolve to the root directory itself.
assert.equal(resolveUploadPath(""), null);

// --- Ownership ---
// Every uploader writes "<userId>/<uuid>.<ext>", so the first segment is
// the owner. A caller must never reach outside their own prefix.
assert.equal(ownsUploadPath("user123", "user123/abc.png"), true);
assert.equal(ownsUploadPath("user123", "otheruser/abc.png"), false);

// Prefix-collision: "user1" must not be able to read "user123"'s files
// just because one id is a string prefix of the other.
assert.equal(ownsUploadPath("user1", "user123/abc.png"), false);

// A bare filename has no owner segment — deny rather than default-allow.
assert.equal(ownsUploadPath("user123", "abc.png"), false);

// --- Content types ---
// Recordings must report a real audio type or the <audio> player and
// Range-based seeking won't work.
assert.equal(contentTypeFor("u/x.webm"), "audio/webm");
assert.equal(contentTypeFor("u/x.m4a"), "audio/mp4");
assert.equal(contentTypeFor("u/x.png"), "image/png");
assert.equal(contentTypeFor("u/x.pdf"), "application/pdf");

// Case shouldn't matter — browsers and phones produce ".PNG" happily.
assert.equal(contentTypeFor("u/x.PNG"), "image/png");

// Unknown extensions fall back to octet-stream, which downloads instead
// of rendering — notably, never text/html, which would let an uploaded
// file execute script on this origin.
assert.equal(contentTypeFor("u/x.unknown"), "application/octet-stream");
assert.equal(contentTypeFor("u/noextension"), "application/octet-stream");

console.log("uploads.test.ts: all checks passed");
