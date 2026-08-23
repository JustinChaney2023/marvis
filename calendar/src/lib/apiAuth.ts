import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiToken } from "@/lib/apiTokens";
import { createRateLimiter, requestIp } from "@/lib/rateLimit";

// A leaked token is a standing credential, not a single login attempt —
// generous enough for a sync client polling every few seconds, tight
// enough to blunt a runaway/malicious loop. Keyed by token hash (not IP)
// so one leaked token can't be worked around by rotating IPs, and a
// legitimate multi-device user isn't limited by a shared IP.
const isRateLimited = createRateLimiter(120, 60_000);

type ApiAuthResult = { user: { id: string } } | { error: NextResponse };

/** Bearer-token counterpart to requireUser() — for /api/v1/* routes only. */
export async function requireApiUser(request: NextRequest): Promise<ApiAuthResult> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { error: NextResponse.json({ error: "Missing or malformed Authorization header." }, { status: 401 }) };
  }
  const tokenHash = hashApiToken(match[1].trim());

  if (isRateLimited(tokenHash)) {
    return { error: NextResponse.json({ error: "Too many requests." }, { status: 429 }) };
  }

  const token = await prisma.personalAccessToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!token || (token.expiresAt && token.expiresAt < new Date())) {
    // Falls through to the generic IP-agnostic check above too — an
    // invalid token still costs the caller a rate-limit slot, same as a
    // valid one, so guessing tokens isn't a free unlimited-attempt loop.
    if (isRateLimited(await requestIp())) {
      return { error: NextResponse.json({ error: "Too many requests." }, { status: 429 }) };
    }
    return { error: NextResponse.json({ error: "Invalid or expired token." }, { status: 401 }) };
  }

  await prisma.personalAccessToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });

  return { user: { id: token.userId } };
}
