import { prisma } from "@/lib/prisma";

// Fixed id + upsert, not findFirst-then-create — the latter races under
// concurrent calls (two requests both see "no row" and both create one),
// which happened in practice while testing this.
const SINGLETON_ID = "app-settings";

export async function getAppSettings() {
  return prisma.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
}

export async function updateAppSettings(data: { bufferMin?: number }) {
  return prisma.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
}
