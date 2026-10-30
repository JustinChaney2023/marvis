import mammoth from "mammoth";
import { convertToMarkdown } from "@/lib/markitdown";
import { pickConverter } from "@/lib/documentConvert";

/**
 * Turns a file buffer into Markdown text — shared by the syllabus upload
 * step and by task-attachment text extraction (subtask generation reads
 * an assignment file's own attachment the same way).
 *
 * .docx stays on mammoth in-process rather than going through the
 * converter service: it already works with nothing configured, and
 * regressing a working offline path into a service dependency would be a
 * straight downgrade. Everything else (PDF and friends) needs the
 * markitdown service.
 */
export async function convertFileBufferToText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  markitdownUrl: string | null,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const converter = pickConverter(filename);
  if (converter === null || converter === "text") {
    return { ok: false, error: "That file type isn't supported — paste the text instead." };
  }

  if (converter === "docx") {
    try {
      // mammoth 1.12 added convertToMarkdown at runtime, but its bundled
      // index.d.ts hasn't caught up (still only declares convertToHtml/
      // extractRawText) — cast rather than wait on the upstream types fix.
      const mammothWithMarkdown = mammoth as unknown as {
        convertToMarkdown: typeof mammoth.extractRawText;
      };
      const { value } = await mammothWithMarkdown.convertToMarkdown({ buffer });
      if (!value.trim()) return { ok: false, error: "Couldn't find any text in that file." };
      return { ok: true, text: value };
    } catch {
      return { ok: false, error: "Couldn't read that .docx file — it may be corrupted." };
    }
  }

  if (!markitdownUrl) {
    return {
      ok: false,
      error:
        "PDFs and other documents need the conversion service. Set it up in Settings → AI (see docs/markitdown-setup.md), or paste the text instead.",
    };
  }
  return convertToMarkdown(buffer, filename, mimeType, markitdownUrl);
}
