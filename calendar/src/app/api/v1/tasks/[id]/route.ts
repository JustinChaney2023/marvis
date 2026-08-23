import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/apiAuth";

const STATUSES = ["CREATED", "ONGOING", "DELAYED", "DONE"] as const;

function serialize(t: { id: string; title: string; notes: string | null; status: string; priority: number; dueAt: Date | null; projectId: string | null }) {
  return { id: t.id, title: t.title, notes: t.notes, status: t.status, priority: t.priority, dueAt: t.dueAt, projectId: t.projectId };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const task = await prisma.task.findFirst({ where: { id, userId: auth.user.id } });
  if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(serialize(task));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const task = await prisma.task.findFirst({ where: { id, userId: auth.user.id } });
  if (!task) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  const data: { title?: string; notes?: string | null; status?: (typeof STATUSES)[number] } = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string." }, { status: 400 });
    }
    data.title = body.title.trim();
  }
  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return NextResponse.json({ error: "notes must be a string or null." }, { status: 400 });
    }
    data.notes = body.notes;
  }
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}.` }, { status: 400 });
    }
    data.status = body.status;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update — provide title, notes, and/or status." }, { status: 400 });
  }

  const updated = await prisma.task.update({ where: { id }, data });
  return NextResponse.json(serialize(updated));
}
