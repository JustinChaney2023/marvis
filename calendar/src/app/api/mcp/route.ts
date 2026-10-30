import { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/apiAuth";
import { appOrigin, mcpAuthChallenge } from "@/lib/oauth";
import { methodNotAllowed, respondToMcpPost } from "./handler";

// MCP endpoint for clients that send an Authorization header: a personal
// access token, or one issued through the OAuth flow (src/lib/oauth.ts).
// A 401 carries the WWW-Authenticate pointer MCP clients use to discover
// that flow — that's how claude.ai knows to show the "Allow" screen.
export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("error" in auth) {
    if (auth.error.status === 401) {
      auth.error.headers.set("WWW-Authenticate", mcpAuthChallenge(appOrigin(request)));
    }
    return auth.error;
  }
  return respondToMcpPost(request, auth.user.id);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
