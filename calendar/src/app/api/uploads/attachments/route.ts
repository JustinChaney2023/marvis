import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth";

// Documents run bigger than a note image — 20MB covers a typical PDF/
// slide deck without turning this into a video host.
const MAX_BYTES = 20 * 1024 * 1024;
// svg deliberately excluded, same reasoning as the note-image uploader
// (embedded <script> is an active XSS vector for that one format).
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Task attachment upload — same convention as ../route.ts (task-notes
 * images): random on-disk filename under public/uploads/<userId>/, the
 * client-supplied name is never trusted for the path. Public/ is
 * unauthenticated static hosting, same accepted tradeoff as that route.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be under 20MB." }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "That file type isn't supported." }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "public", "uploads", user.id);
  await mkdir(dir, { recursive: true });
  const storedName = `${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, storedName), bytes);

  return NextResponse.json({
    storedPath: `${user.id}/${storedName}`,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}
