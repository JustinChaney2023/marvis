import { headers } from "next/headers";

/**
 * Plain in-memory sliding-window limiter, keyed by caller-supplied string
 * (usually an IP). Not durable across restarts and not proof against a
 * distributed attacker rotating IPs — the same tradeoff already accepted
 * for the booking page's limiter. Good enough to stop the cheap case
 * (one script grinding logins/signups/bookings) at this app's scale.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const attempts = new Map<string, number[]>();
  return function isLimited(key: string): boolean {
    const now = Date.now();
    const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      attempts.set(key, recent);
      return true;
    }
    recent.push(now);
    attempts.set(key, recent);
    return false;
  };
}

/** Best-effort caller IP from the request headers (behind a proxy or not). */
export async function requestIp(): Promise<string> {
  const headerStore = await headers();
  return (
    headerStore.get("x-forwarded-for")?.split(",")[0].trim() ??
    headerStore.get("x-real-ip") ??
    "unknown"
  );
}
