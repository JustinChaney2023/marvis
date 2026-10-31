import { NextResponse } from "next/server";
import { appOrigin, authorizationServerMetadata, CORS_HEADERS } from "@/lib/oauth";

// RFC 8414 authorization server metadata (path-suffixed variants included).
export function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(appOrigin(request)), { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
