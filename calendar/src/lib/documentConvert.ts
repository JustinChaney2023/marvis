// Which converter handles which file, shared by the client (decide whether
// to read locally or upload) and the server (decide what to actually do).
// Deliberately free of prisma/node imports so it can enter a client bundle,
// same split as chatActions.ts and recordingFormat.ts.

export type Converter =
  /** Plain text — read client-side via FileReader, no server round-trip. */
  | "text"
  /** .docx — mammoth, in-process on the server. Works with no service configured. */
  | "docx"
  /** Everything else markitdown handles — needs the conversion service. */
  | "markitdown";

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];

// Formats markitdown converts, restricted to ones plausibly holding a
// syllabus. Deliberately excludes .zip (it recurses into archive contents,
// which is a surprising amount of reach for a "pick your syllabus" input)
// and audio/video (that is the recordings pipeline's job, not this one).
const MARKITDOWN_EXTENSIONS = [
  ".pdf",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".doc",
  ".csv",
  ".html",
  ".htm",
  ".epub",
  ".msg",
  ".rtf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tiff",
];

/** Null = unsupported; the caller should say so rather than trying anything. */
export function pickConverter(filename: string): Converter | null {
  const name = filename.toLowerCase();
  // endsWith, not a split on ".", so "notes.v2.final.pdf" still resolves.
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) return "text";
  if (name.endsWith(".docx")) return "docx";
  if (MARKITDOWN_EXTENSIONS.some((ext) => name.endsWith(ext))) return "markitdown";
  return null;
}

/** A PDF scan runs far larger than a .docx of the same syllabus. */
export const MAX_CONVERT_BYTES = 25 * 1024 * 1024;

export function isWithinSizeLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_CONVERT_BYTES;
}

/** `accept` for the file input — extensions only; browsers disagree on MIME for these. */
export const IMPORT_FILE_ACCEPT = [
  ...TEXT_EXTENSIONS,
  ".docx",
  ...MARKITDOWN_EXTENSIONS,
].join(",");
