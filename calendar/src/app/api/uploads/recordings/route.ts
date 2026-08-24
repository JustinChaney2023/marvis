import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import path from "node:path";
import { requireUser } from "@/lib/auth";
import { audioExtensionFor } from "@/lib/recordings";

// An hour of Opus is ~30MB, but an uncompressed WAV of the same lecture
// is an order of magnitude bigger, and phone voice-memo exports aren't
// always efficient. 300MB covers a long recording in a naive format
// without becoming general-purpose file hosting.
const MAX_BYTES = 300 * 1024 * 1024;

/**
 * Audio upload for recordings (#16) — separate from the attachments
 * route because the size cap is an order of magnitude larger and the
 * accepted types are disjoint. Same storage discipline as every other
 * uploader here: random server-generated name under
 * public/uploads/<userId>/, client filename never touches the path.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Recording must be under 300MB." }, { status: 400 });
  }
  const ext = audioExtensionFor(file.type);
  if (!ext) {
    return NextResponse.json({ error: "That audio format isn't supported." }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "public", "uploads", user.id);
  await mkdir(dir, { recursive: true });
  const storedName = `${randomUUID()}.${ext}`;
  // Streamed rather than Buffer.from(await file.arrayBuffer()) like the
  // smaller uploaders: a 300MB cap makes buffering the whole file a real
  // heap spike, and writeFile accepts an async iterable directly.
  // The cast is only a lib-types mismatch: File.stream() is typed as the
  // DOM ReadableStream, which structurally differs from node:stream/web's
  // even though it's the very same object at runtime under Node.
  await writeFile(
    path.join(dir, storedName),
    Readable.fromWeb(file.stream() as NodeReadableStream<Uint8Array>),
  );

  return NextResponse.json({
    storedPath: `${user.id}/${storedName}`,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}
