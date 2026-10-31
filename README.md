# marvis

A Jarvis-like personal assistant. The main app is **Season** (`calendar/`) — a
calm personal OS for your calendar, tasks, and focus time.

## What's here

| Path | What |
| --- | --- |
| [`calendar/`](calendar/README.md) | **Season**: Next.js + SQLite app — calendar, tasks with Motion-style auto-scheduling, focus timer, projects, recordings, and an MCP server so Claude can use it |
| [`markitdown/`](markitdown/) | Optional Docker service that converts uploaded documents (PDF, DOCX, …) to Markdown for syllabus import |
| [`whisper/`](whisper/) | Optional local speech-to-text service for recordings |
| [`docs/`](docs/) | Roadmap, product references, and setup guides |

## Season highlights

- **Quick add anywhere** — press `c` (or the **+** tab on a phone) and type
  `essay draft fri 3pm 2h !! #english`; Season shows what it understood as you type.
- **Auto-scheduling** — open tasks get placed into free time around your events.
- **Phone-friendly** — bottom tab bar, installable to your Home Screen, and push
  reminders even when the app is closed.
- **Claude can use it** — add `https://YOUR-HOST/api/mcp` as a connector in
  Claude and click Allow (see [`calendar/docs/mcp.md`](calendar/docs/mcp.md)).

## Getting started

```bash
cd calendar
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Then open http://localhost:3000 and sign up — the first account is the admin.
