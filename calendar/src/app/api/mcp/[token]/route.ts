import { NextRequest } from "next/server";
import { authenticateApiToken } from "@/lib/apiAuth";
import { methodNotAllowed, respondToMcpPost } from "../handler";

// Same endpoint with the token in the path, for MCP clients that only take
// a URL (claude.ai / Claude mobile custom connectors). The URL itself is
// the credential — revoke the token in Settings → API to kill it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const auth = await authenticateApiToken(decodeURIComponent(token));
  if ("error" in auth) return auth.error;
  return respondToMcpPost(request, auth.user.id);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
