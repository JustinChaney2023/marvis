import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { createRecording, listRecordings } from "@/lib/recordings";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const recordings = await listRecordings(auth.user.id, {
    eventId: searchParams.get("eventId"),
    projectId: searchParams.get("projectId"),
  });
  return NextResponse.json({
    recordings: recordings.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      errorMessage: r.errorMessage,
      durationSec: r.durationSec,
      eventId: r.eventId,
      projectId: r.projectId,
      createdAt: r.createdAt,
    })),
  });
}

/**
 * Registers an already-uploaded audio file as a recording and kicks off
 * processing. The upload itself still goes through
 * POST /api/uploads/recordings (multipart); this takes the storedPath
 * that returns, same two-step split the web UI uses.
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  const { title, audioPath, mimeType, sizeBytes, eventId, projectId } = body as Record<string, unknown>;
  if (typeof audioPath !== "string" || typeof mimeType !== "string" || typeof sizeBytes !== "number") {
    return NextResponse.json(
      { error: "audioPath (string), mimeType (string) and sizeBytes (number) are required." },
      { status: 400 },
    );
  }

  const result = await createRecording(auth.user.id, {
    title: typeof title === "string" ? title : "",
    audioPath,
    mimeType,
    sizeBytes,
    eventId: typeof eventId === "string" ? eventId : null,
    projectId: typeof projectId === "string" ? projectId : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ id: result.id }, { status: 201 });
}
