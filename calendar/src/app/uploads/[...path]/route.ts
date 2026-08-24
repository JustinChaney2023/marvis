import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth";
import { requireApiUser } from "@/lib/apiAuth";
import { contentTypeFor, ownsUploadPath, resolveUploadPath } from "@/lib/uploads";

/**
 * Authenticated replacement for what used to be plain static hosting of
 * public/uploads/. The URL shape is unchanged on purpose: note images are
 * embedded as ![](/uploads/<userId>/<uuid>.png) inside stored note
 * markdown, so changing it would mean rewriting every note's content.
 * Only the serving mechanism changed — static → this route.
 *
 * Accepts either auth the app already has: a session cookie (the web UI's
 * <img>/<audio> tags, which can't set headers) or a bearer token (the
 * Obsidian plugin / any /api/v1 consumer). getCurrentUser rather than
 * requireUser because requireUser redirects to /login, and an <img>
 * following a redirect to an HTML page renders as a broken image instead
 * of failing honestly.
 */
async function authenticate(request: NextRequest): Promise<string | null> {
  const session = await getCurrentUser();
  if (session) return session.id;
  // Only pay for the token lookup when one was actually offered.
  if (request.headers.get("authorization")) {
    const api = await requireApiUser(request);
    if (!("error" in api)) return api.user.id;
  }
  return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const userId = await authenticate(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const storedPath = (await params).path.join("/");
  const absolute = resolveUploadPath(storedPath);
  // 404 rather than 403 for someone else's file: a distinct "exists but
  // isn't yours" leaks that the id is real.
  if (!absolute || !ownsUploadPath(userId, storedPath)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const contentType = contentTypeFor(storedPath);
  // Filenames are server-generated UUIDs, so content never changes under
  // a URL — but keep it private and short-lived rather than immutable:
  // these can be lecture recordings on a shared machine.
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };

  // Static hosting answered Range requests; dropping that would break
  // seeking in a 50-minute recording (Safari won't play audio without it).
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || end < start) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
    const stream = Readable.toWeb(createReadStream(absolute, { start, end })) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    headers: { ...headers, "Content-Length": String(info.size) },
  });
}
