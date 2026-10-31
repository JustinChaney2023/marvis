import { NextResponse } from "next/server";
import { handleMcpMessage } from "@/lib/mcp";

// Stateless Streamable-HTTP MCP: every POST carries one JSON-RPC message
// (or a batch) and gets a plain application/json reply — no session ids,
// no SSE stream, which the spec allows and every current client accepts.
export async function respondToMcpPost(request: Request, userId: string): Promise<Response> {
  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400 },
    );
  }

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleMcpMessage(m, userId)))).filter((r) => r !== null);
    return responses.length ? NextResponse.json(responses) : new Response(null, { status: 202 });
  }
  const response = await handleMcpMessage(body, userId);
  return response ? NextResponse.json(response) : new Response(null, { status: 202 });
}

// No server-initiated stream to offer (GET) and no session to end (DELETE).
export function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
