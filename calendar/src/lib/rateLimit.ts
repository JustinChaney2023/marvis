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

/**
 * Best-effort caller IP from the request headers. `x-forwarded-for` is
 * fully client-controlled unless something in front of the app strips and
 * resets it — a caller can rotate it per-request to get a fresh rate-limit
 * bucket every time. `cf-connecting-ip` doesn't have that problem: it's
 * only ever set by Cloudflare itself (any client-supplied copy is
 * overwritten at Cloudflare's edge before reaching the origin), which is
 * this app's actual deployment path, so prefer it when present.
 */
export async function requestIp(): Promise<string> {
  const headerStore = await headers();
  return (
    headerStore.get("cf-connecting-ip") ??
    headerStore.get("x-forwarded-for")?.split(",")[0].trim() ??
    headerStore.get("x-real-ip") ??
    "unknown"
  );
}
