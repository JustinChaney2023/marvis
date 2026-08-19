"use client";

import { useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

type Props = {
  name: string;
  defaultValue: string;
};

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800";

const toolbarButtonClass =
  "flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700";

/**
 * Task notes are plain markdown (Task.notes — no schema change), edited
 * here with a formatting toolbar that inserts markdown syntax at the
 * cursor rather than a full WYSIWYG/contentEditable editor — far less
 * code and far fewer edge cases than reimplementing rich text, while
 * still giving bold/italic/headings/lists/checklists/links/images.
 * "Preview" renders the current text through the same renderMarkdown
 * used everywhere else notes are displayed.
 */
export default function NotesEditor({ name, defaultValue }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wraps the current selection with `before`/`after` (or inserts
  // `placeholder` at the cursor if nothing's selected), then restores
  // focus with the inserted text selected so a second keystroke
  // naturally overtypes it.
  const applyWrap = (before: string, after: string, placeholder: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const selected = value.slice(selectionStart, selectionEnd) || placeholder;
    const next = value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = selectionStart + before.length;
      el.selectionEnd = selectionStart + before.length + selected.length;
    });
  };

  // Prefixes the current line(s) — for headings/lists/checklists, which
  // apply per-line rather than wrapping a span of inline text.
  const applyLinePrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const lineEnd = value.indexOf("\n", selectionEnd);
    const end = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, end);
    const prefixed = block
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    const next = value.slice(0, lineStart) + prefixed + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = lineStart;
      el.selectionEnd = lineStart + prefixed.length;
    });
  };

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const next = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
    setValue(next);
    const caret = selectionStart + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = caret;
    });
  };

  const handleImageChosen = async (file: File) => {
    setUploadError(null);
    setIsUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      insertAtCursor(`![](${data.url})`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-600 dark:bg-zinc-900/40">
        <button type="button" title="Bold" className={`${toolbarButtonClass} font-bold`} onClick={() => applyWrap("**", "**", "bold text")}>
          B
        </button>
        <button type="button" title="Italic" className={`${toolbarButtonClass} italic`} onClick={() => applyWrap("*", "*", "italic text")}>
          I
        </button>
        <button type="button" title="Underline" className={`${toolbarButtonClass} underline`} onClick={() => applyWrap("<u>", "</u>", "underlined text")}>
          U
        </button>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button type="button" title="Heading" className={toolbarButtonClass} onClick={() => applyLinePrefix("## ")}>
          H
        </button>
        <button type="button" title="Bulleted list" className={toolbarButtonClass} onClick={() => applyLinePrefix("- ")}>
          •—
        </button>
        <button type="button" title="Numbered list" className={toolbarButtonClass} onClick={() => applyLinePrefix("1. ")}>
          1.
        </button>
        <button type="button" title="Checklist" className={toolbarButtonClass} onClick={() => applyLinePrefix("- [ ] ")}>
          ☐
        </button>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <button
          type="button"
          title="Link"
          className={toolbarButtonClass}
          onClick={() => applyWrap("[", "](https://)", "link text")}
        >
          🔗
        </button>
        <button
          type="button"
          title="Image"
          className={toolbarButtonClass}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? "…" : "🖼"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleImageChosen(file);
          }}
        />
        <button
          type="button"
          className={`${toolbarButtonClass} ml-auto`}
          onClick={() => setMode((m) => (m === "write" ? "preview" : "write"))}
        >
          {mode === "write" ? "Preview" : "Write"}
        </button>
      </div>

      {mode === "write" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={5}
          placeholder="Notes... supports **bold**, links, images, checklists"
          className={`${inputClass} rounded-t-none`}
        />
      ) : (
        <div
          className="min-h-[7.5rem] rounded-b-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 [&_a]:text-indigo-600 [&_a]:underline dark:[&_a]:text-indigo-400 [&_img]:mt-1 [&_li]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_p]:mb-2"
          dangerouslySetInnerHTML={{ __html: value ? renderMarkdown(value) : "<p class='text-zinc-400'>Nothing to preview yet.</p>" }}
        />
      )}
      {uploadError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
    </div>
  );
}
