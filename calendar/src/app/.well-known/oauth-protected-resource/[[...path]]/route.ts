import { NextResponse } from "next/server";
import { appOrigin, CORS_HEADERS, protectedResourceMetadata } from "@/lib/oauth";

// RFC 9728 — served at both /.well-known/oauth-protected-resource and the
// path-suffixed /.well-known/oauth-protected-resource/api/mcp form.
export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(appOrigin(request)), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
