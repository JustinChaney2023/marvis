import { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { methodNotAllowed, respondToMcpPost } from "./handler";

// MCP endpoint for clients that can send an Authorization header
// (Claude Code, Claude Desktop via mcp-remote): Bearer <personal access token>.
export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("error" in auth) return auth.error;
  return respondToMcpPost(request, auth.user.id);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
