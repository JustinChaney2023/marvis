import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a note image, not a video host
// svg deliberately excluded — an SVG can carry an embedded <script>, one
// of the few image formats that's an active XSS vector, not just a
// passive one.
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Task-notes image upload. Files land under public/uploads/<userId>/
 * with a random name (the original filename is never trusted — no
 * path-traversal surface, no extension sniffing) and are served back as
 * plain static assets. That means the URL, once known, isn't itself
 * gated by a login check (public/ is unauthenticated static hosting by
 * nature) — acceptable for this app's "you + friends you trust" model,
 * same tradeoff already accepted for the booking page's public surface.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 5MB." }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG, JPEG, GIF, or WEBP images are supported." },
      { status: 400 },
    );
  }

  const dir = path.join(process.cwd(), "public", "uploads", user.id);
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), bytes);

  return NextResponse.json({ url: `/uploads/${user.id}/${filename}` });
}
