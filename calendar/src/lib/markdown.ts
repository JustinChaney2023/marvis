import { marked } from "marked";

// Task notes are markdown, rendered to HTML for display. `marked` on its
// own still passes through literal `<script>`/`on*=` HTML in the source
// and doesn't vet link/image URL schemes — historically why it shipped a
// `sanitize` option (removed in v5+, now "pair with DOMPurify" instead).
// This app's notes are private to their own author (never rendered to
// anyone else), so the realistic risk is only ever self-XSS — not worth
// a second dependency (DOMPurify) for. Still worth the few lines below:
// drop raw HTML tags entirely, and reject non-http(s)/mailto/relative
// link and image URLs (the actual exploitable vector even without raw
// HTML — `[x](javascript:...)` needs no HTML tag at all).
function isSafeUrl(href: string): boolean {
  return /^(https?:|mailto:|\/|#)/i.test(href.trim());
}

// `title`/`alt` land inside a double-quoted HTML attribute below — a
// markdown title/alt string containing a literal `"` (e.g. an escaped
// `\"` in the source) would otherwise close the attribute early and let
// the rest of its own text be parsed as new attributes (an
// `onmouseover=` etc.), the exact class of bug this file's own href
// scheme check exists to prevent for links/images themselves.
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const renderer = new marked.Renderer();

renderer.html = () => "";

renderer.link = ({ href, title, tokens }) => {
  const text = renderer.parser.parseInline(tokens);
  if (!isSafeUrl(href)) return text;
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
};

renderer.image = ({ href, title, text }) => {
  if (!isSafeUrl(href)) return text;
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}"${titleAttr} class="max-w-full rounded-lg" />`;
};

marked.setOptions({ renderer, breaks: true });

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}
