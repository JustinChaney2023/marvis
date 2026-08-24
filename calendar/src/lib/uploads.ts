import path from "node:path";

/**
 * Uploads deliberately live OUTSIDE public/ — anything under public/ is
 * unauthenticated static hosting, which meant every uploaded file (note
 * images, attachments, and recordings) was fetchable by URL with no
 * session at all. Random UUID names made that unguessable, not
 * access-controlled. Recordings raised the stakes: lecture/meeting audio
 * can carry other people's voices, and URLs leak through channels file
 * contents don't (history, referrers, backups, vault sync).
 *
 * Every read now goes through the authenticated /uploads/[...path]
 * route, which keeps the original URL shape so already-stored note-image
 * embeds keep resolving.
 */
export const UPLOADS_ROOT = path.join(process.cwd(), "var", "uploads");

/**
 * Absolute on-disk path for a stored "<userId>/<uuid>.<ext>", or null if
 * it escapes UPLOADS_ROOT.
 *
 * Resolve-then-verify rather than string inspection alone: an absolute
 * input ("/etc/passwd") wins over the base in path.resolve, so only
 * checking for ".." would miss it. The separator is appended to the
 * prefix so a sibling directory ("var/uploads-evil") can't satisfy a
 * bare startsWith. The "..'/NUL checks are belt-and-braces on top.
 */
export function resolveUploadPath(storedPath: string): string | null {
  if (!storedPath || storedPath.includes("..") || storedPath.includes("\0")) return null;
  const absolute = path.resolve(UPLOADS_ROOT, storedPath);
  if (absolute !== UPLOADS_ROOT && !absolute.startsWith(UPLOADS_ROOT + path.sep)) return null;
  return absolute;
}

/**
 * Ownership check for a stored path. Every uploader writes
 * "<userId>/<server-generated-uuid>.<ext>", so the first segment is the
 * owner and a caller can only ever reach files under their own prefix.
 *
 * Deliberately not a database lookup: note images have no row anywhere —
 * they're embedded straight into note markdown — so a row-based check
 * couldn't cover them at all, and would leave the one file type with no
 * delete path as the only unprotected case. Deletes already unlink the
 * file, so a row-less leftover is an orphan on the owner's own prefix,
 * not a cross-user leak.
 */
export function ownsUploadPath(userId: string, storedPath: string): boolean {
  return storedPath.split("/")[0] === userId;
}

// Only the extensions the three upload routes can actually produce —
// see their ALLOWED_TYPES maps and audioExtensionFor(). Anything else
// falls back to octet-stream, which downloads rather than renders.
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

export function contentTypeFor(storedPath: string): string {
  const ext = storedPath.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
