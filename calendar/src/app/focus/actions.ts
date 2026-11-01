"use server";

import { requireUser } from "@/lib/auth";
import { aiConfigFromSettings, getAppSettings } from "@/lib/settings";
import { userTimeZone } from "@/lib/timezone";
import { buildTodayFacts, generateDailyAgendaText } from "@/lib/dailyAgenda";

// The AI-phrased version of the agenda line. Focus renders the plain
// template instantly and swaps this in when it arrives, so a slow or
// unreachable model never holds up the page.
export async function polishAgenda(): Promise<string> {
  const user = await requireUser();
  const timeZone = userTimeZone(user);
  const { localAi, anthropicApiKey } = aiConfigFromSettings(await getAppSettings(user.id));
  const facts = await buildTodayFacts(user.id, timeZone);
  return generateDailyAgendaText(facts, localAi, anthropicApiKey, timeZone);
}
