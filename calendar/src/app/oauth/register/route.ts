import { NextResponse } from "next/server";
import { CORS_HEADERS, registerClient } from "@/lib/oauth";
import { createRateLimiter, requestIp } from "@/lib/rateLimit";

// Registration is unauthenticated by design (RFC 7591 open registration),
// so cap how fast one caller can mint client rows.
const isRateLimited = createRateLimiter(20, 60 * 60_000);

export async function POST(request: Request) {
  if (isRateLimited(await requestIp())) {
    return NextResponse.json({ error: "slow_down" }, { status: 429, headers: CORS_HEADERS });
  }
  const body = await request.json().catch(() => null);
  const result = await registerClient(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, error_description: result.description },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  return NextResponse.json(result.body, { status: 201, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
