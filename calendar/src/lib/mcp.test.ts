import assert from "node:assert/strict";
import { handleMcpMessage, parseUserTime, MCP_TOOL_NAMES, MCP_PROMPT_NAMES } from "./mcp";

// Protocol-level checks only — none of these touch the database.
async function main() {
  {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      "user",
    );
    assert.ok(res && "result" in res);
    const result = res.result as { protocolVersion: string; serverInfo: { name: string } };
    assert.equal(result.protocolVersion, "2025-03-26");
    assert.equal(result.serverInfo.name, "season");
  }

  // An unknown protocol version falls back to the newest supported one.
  {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      "user",
    );
    assert.ok(res && "result" in res);
    assert.equal((res.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  }

  // Notifications get no response at all.
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, "user"), null);

  {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "user");
    assert.ok(res && "result" in res);
    const tools = (res.result as { tools: { name: string; inputSchema: { type: string } }[] }).tools;
    assert.deepEqual(tools.map((t) => t.name), MCP_TOOL_NAMES);
    for (const t of tools) assert.equal(t.inputSchema.type, "object", t.name);
    assert.ok(MCP_TOOL_NAMES.includes("create_task"));
  }

  {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, "user");
    assert.ok(res && "error" in res);
    assert.equal(res.error.code, -32601);
  }
  {
    const res = await handleMcpMessage({ id: 4, method: "ping" }, "user");
    assert.ok(res && "error" in res);
    assert.equal(res.error.code, -32600);
  }

  // Bad arguments come back as a tool error result, not a protocol error.
  {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "complete_task", arguments: {} } },
      "user",
    );
    assert.ok(res && "result" in res);
    assert.equal((res.result as { isError?: boolean }).isError, true);
  }

  {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "prompts/list" }, "user");
    assert.ok(res && "result" in res);
    const prompts = (res.result as { prompts: { name: string }[] }).prompts;
    assert.deepEqual(prompts.map((p) => p.name), MCP_PROMPT_NAMES);
  }
  {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 7, method: "prompts/get", params: { name: "brain_dump", arguments: { notes: "call mom; fix bike" } } },
      "user",
    );
    assert.ok(res && "result" in res);
    const msg = (res.result as { messages: { content: { text: string } }[] }).messages[0];
    assert.match(msg.content.text, /call mom; fix bike/);
  }

  // Time parsing: naive times are the user's wall clock, bare dates get
  // the default hour, explicit offsets are kept.
  const tz = "America/Chicago";
  assert.equal(parseUserTime("2026-11-03", tz).toISOString(), "2026-11-03T23:00:00.000Z");
  assert.equal(parseUserTime("2026-11-03", tz, 0).toISOString(), "2026-11-03T06:00:00.000Z");
  assert.equal(parseUserTime("2026-07-01T09:30", tz).toISOString(), "2026-07-01T14:30:00.000Z");
  assert.equal(parseUserTime("2026-07-01T09:30:00Z", tz).toISOString(), "2026-07-01T09:30:00.000Z");
  assert.throws(() => parseUserTime("next tuesday-ish", tz));
  assert.throws(() => parseUserTime("2026-02-30", tz));
  assert.throws(() => parseUserTime("2026-02-10T25:00", tz));

  console.log("mcp.test.ts: all checks passed");
}

main();
