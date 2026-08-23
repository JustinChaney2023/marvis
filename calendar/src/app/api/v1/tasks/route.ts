import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/apiAuth";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");

  const tasks = await prisma.task.findMany({
    where: {
      userId: auth.user.id,
      parentId: null, // subtasks aren't independently listable via the API, same as the UI
      ...(projectId ? { projectId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      projectId: t.projectId,
    })),
  });
}
