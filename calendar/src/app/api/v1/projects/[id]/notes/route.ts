import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/apiAuth";

async function ownedProject(userId: string, id: string) {
  return prisma.project.findFirst({ where: { id, userId }, select: { id: true, notes: true } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const project = await ownedProject(auth.user.id, id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ notes: project.notes });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const project = await ownedProject(auth.user.id, id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.notes !== "string") {
    return NextResponse.json({ error: "Body must be { notes: string }." }, { status: 400 });
  }

  await prisma.project.update({ where: { id }, data: { notes: body.notes } });
  return NextResponse.json({ notes: body.notes });
}
