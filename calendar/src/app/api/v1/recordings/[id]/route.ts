import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { deleteRecording, getRecording, parseActionItems } from "@/lib/recordings";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const recording = await getRecording(auth.user.id, id);
  if (!recording) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    id: recording.id,
    title: recording.title,
    status: recording.status,
    errorMessage: recording.errorMessage,
    durationSec: recording.durationSec,
    transcript: recording.transcript,
    summary: recording.summary,
    actionItems: parseActionItems(recording.actionItems),
    eventId: recording.eventId,
    projectId: recording.projectId,
    createdAt: recording.createdAt,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const deleted = await deleteRecording(auth.user.id, id);
  if (!deleted) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
