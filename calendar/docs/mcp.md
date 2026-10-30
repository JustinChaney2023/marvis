# Season MCP server

Season exposes an [MCP](https://modelcontextprotocol.io) server so Claude can
read and change your tasks, projects, and calendar. Code: `src/lib/mcp.ts`
(tools + JSON-RPC), `src/app/api/mcp/` (routes).

## Connect

1. Settings → Account → **API tokens & Claude** → create a token (e.g. "Claude").
2. Expand **Use this token to connect Claude** and copy the snippet for your client:

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add --transport http season https://YOUR-HOST/api/mcp --header "Authorization: Bearer <token>"` |
| claude.ai / Claude mobile & desktop apps | Settings → Connectors → Add custom connector → URL `https://YOUR-HOST/api/mcp/<token>` |
| Claude Desktop (local config) | `npx -y mcp-remote https://YOUR-HOST/api/mcp --header "Authorization: Bearer <token>"` in `claude_desktop_config.json` |

claude.ai connectors call your server from Anthropic's cloud, so the app must be
reachable over the internet (a localhost URL only works for Claude Code / Claude
Desktop on the same machine). The `/api/mcp/<token>` form puts the credential in
the URL — keep it private, and revoke the token in Settings to cut access.

## Tools

| Tool | What it does |
| --- | --- |
| `get_overview` | Today's calendar, overdue tasks, tasks due this week, unscheduled count |
| `list_tasks` / `get_task` | Browse tasks (filter by status, project, search, due-before) |
| `create_task` | Structured fields or quick-capture text (`"essay fri 5pm #english 2h p2"`), optional subtasks and auto-schedule |
| `update_task` / `complete_task` / `delete_task` | Edit, finish (recurring tasks roll forward), or remove |
| `add_subtasks` | Checklist items under a task |
| `schedule_tasks` | Run the auto-scheduler for one task or everything |
| `list_projects` / `create_project` | Projects |
| `list_events` / `create_event` / `delete_event` | Calendar (recurring events expanded) |

Times are ISO 8601; a time without an offset is read in the user's own timezone
(Settings → Scheduling), and a bare due date means 5pm that day.

## Transport

Stateless Streamable HTTP: each `POST` carries one JSON-RPC message (or a batch)
and gets an `application/json` reply. No sessions, no SSE; `GET` returns 405.
Test it by hand:

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_overview","arguments":{}}}'
```
