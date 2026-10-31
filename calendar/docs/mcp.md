# Season MCP server

Season exposes an [MCP](https://modelcontextprotocol.io) server so Claude can
read and change your tasks, projects, and calendar. Code: `src/lib/mcp.ts`
(tools + JSON-RPC), `src/app/api/mcp/` (routes).

## Connect

Every current Claude client supports MCP's OAuth flow, so you only need the URL
`https://YOUR-HOST/api/mcp` (also shown, ready to copy, in Settings → Claude):

| Client | How |
| --- | --- |
| claude.ai / Claude mobile & desktop apps | Settings → Connectors → Add custom connector → paste the URL → **Allow** on Season's screen |
| Claude Code | `claude mcp add --transport http season https://YOUR-HOST/api/mcp`, then `/mcp` to sign in |

claude.ai connectors call your server from Anthropic's cloud, so the app must be
reachable over the internet (a localhost URL only works for Claude Code / Claude
Desktop on the same machine). Set `APP_URL` when Season sits behind a reverse
proxy so the OAuth metadata advertises the public address.

Each approval creates a token named "<client> (connected app)" in Settings → Claude;
revoke it there to disconnect.

### Without OAuth

For clients that can't do OAuth, create a token in Settings → Claude and use either the
`Authorization: Bearer <token>` header on `/api/mcp`, or the URL form
`/api/mcp/<token>` (the URL is then the credential — keep it private). Claude
Desktop via config file: `npx -y mcp-remote https://YOUR-HOST/api/mcp --header "Authorization: Bearer <token>"`.

### How the OAuth flow works

`src/lib/oauth.ts` + `src/app/oauth/*` + `src/app/.well-known/*`:

1. An unauthenticated `POST /api/mcp` returns `401` with
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`.
2. The client reads that (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414).
3. It registers itself at `POST /oauth/register` (RFC 7591; https or loopback redirect URIs only).
4. It sends you to `/oauth/authorize` (PKCE S256 required). You sign in if needed and click Allow.
5. It exchanges the one-time, 5-minute code at `POST /oauth/token` for an access
   token — an ordinary personal access token.

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
| `list_events` / `create_event` / `update_event` / `delete_event` | Calendar (recurring events expanded) |

Prompts (in the client's prompt menu): **Plan my day**, **Weekly review**, and
**Brain dump to tasks**.

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
