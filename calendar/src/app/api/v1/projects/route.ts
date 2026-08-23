import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/apiAuth";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;

  const projects = await prisma.project.findMany({
    where: { userId: auth.user.id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      notes: p.notes,
      fields: p.fields.map((f) => ({ key: f.key, label: f.label, fieldType: f.fieldType, value: f.value })),
    })),
  });
}
