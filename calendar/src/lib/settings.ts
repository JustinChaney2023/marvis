import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/tokenCrypto";
import type { LocalAiConfig } from "@/lib/aiClient";

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
    workDays?: string;
    workStartMin?: number;
    workEndMin?: number;
    secondaryTimezone?: string | null;
    localAiUrl?: string | null;
    localAiModel?: string | null;
    localAiApiKey?: string | null;
    anthropicApiKey?: string | null;
  },
) {
  return prisma.appSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

type AppSettingsRow = Awaited<ReturnType<typeof getAppSettings>>;

/**
 * Every AI feature (syllabus import, subtasks, project generation,
 * schedule chat) needs the same two things out of an AppSettings row —
 * one place to decrypt them instead of six call sites each doing it
 * slightly differently.
 */
export function aiConfigFromSettings(
  settings: AppSettingsRow,
): { localAi: LocalAiConfig | null; anthropicApiKey: string | null } {
  return {
    localAi:
      settings.localAiUrl && settings.localAiModel
        ? {
            url: settings.localAiUrl,
            model: settings.localAiModel,
            apiKey: settings.localAiApiKey ? decryptSecret(settings.localAiApiKey) : null,
          }
        : null,
    anthropicApiKey: settings.anthropicApiKey ? decryptSecret(settings.anthropicApiKey) : null,
  };
}
