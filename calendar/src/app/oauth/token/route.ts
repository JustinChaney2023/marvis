import { NextResponse } from "next/server";
import { CORS_HEADERS, exchangeCode } from "@/lib/oauth";

export async function POST(request: Request) {
  // Spec says form-encoded; accept JSON too for lenient clients.
  const contentType = request.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    params = new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  } else {
    params = new URLSearchParams(await request.text());
  }
  const result = await exchangeCode(params);
  const headers = { ...CORS_HEADERS, "Cache-Control": "no-store" };
  if (!result.ok) {
    return NextResponse.json({ error: result.error, error_description: result.description }, { status: result.status, headers });
  }
  return NextResponse.json(result.body, { headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
