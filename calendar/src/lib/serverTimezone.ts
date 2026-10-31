import { prisma } from "@/lib/prisma";

/**
 * Runs the server process in the owner's own timezone.
 *
 * Season is a self-hosted, mostly single-person app, and a lot of
 * server-side code reasons in "local" time: server-rendered dates, "today"
 * boundaries (daily agenda, Needs attention), and the scheduler's fallback
 * zone. On a cloud host that local zone is UTC — hours off from the person
 * using it — and every client component that formats a date then renders
 * differently on the server than in the browser (a hydration mismatch React
 * has to recover from by re-rendering the page).
 *
 * Node re-reads process.env.TZ whenever it changes, so setting it once at
 * boot (and again when the owner changes their zone) fixes all of that at
 * once. A TZ the deployer set explicitly always wins.
 */
const deployerSetTz = Boolean(process.env.TZ);

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The owner = the admin account (the first one created). */
export async function applyOwnerTimezone(): Promise<void> {
  if (deployerSetTz) return;
  try {
    const owner = await prisma.user.findFirst({
      where: { isAdmin: true, timezone: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { timezone: true },
    });
    if (owner?.timezone && isValidTimeZone(owner.timezone)) process.env.TZ = owner.timezone;
  } catch (err) {
    // A fresh install before migrations — just stay on the host zone.
    console.error("applyOwnerTimezone failed:", err);
  }
}

/** Call after a user's timezone changes; only the owner's moves the server. */
export function maybeApplyTimezoneChange(user: { isAdmin: boolean }, timezone: string): void {
  if (deployerSetTz || !user.isAdmin || !isValidTimeZone(timezone)) return;
  process.env.TZ = timezone;
}
