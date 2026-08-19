import { prisma } from "@/lib/prisma";

export async function getAppSettings(userId: string) {
  return prisma.appSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function updateAppSettings(
  userId: string,
  data: {
    bufferMin?: number;
    dailyCapMin?: number | null;
    localAiUrl?: string | null;
    localAiModel?: string | null;
  },
) {
  return prisma.appSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
