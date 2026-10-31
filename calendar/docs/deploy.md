# Deploying / updating Season

Season is a long-running Node server with a SQLite file database. Updating
an existing server is one command:

```bash
cd ~/marvis            # wherever the repo lives on the server
bash calendar/scripts/deploy.sh
```

It backs up the database (keeps the 14 newest copies in `calendar/backups/`),
pulls `main`, runs `npm ci`, `prisma generate`, `prisma migrate deploy`,
`npm run build`, and restarts the app. Tell it how to restart with
`SEASON_RESTART_CMD` (e.g. `export SEASON_RESTART_CMD="sudo systemctl restart season"`),
or name your systemd unit / pm2 process `season` and it finds it.

## Requirements

- Node **20.19+** (22 recommended) — Prisma 7 requires it.
- Build tools for the native SQLite driver if no prebuilt binary matches your
  platform: `sudo apt install build-essential python3` (Debian/Ubuntu).
- One server process. Push reminders run in-process; if you ever run more
  than one instance against the same database, set
  `SEASON_DISABLE_PUSH_LOOP=1` on all but one.

## Environment (.env)

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | SQLite file. `file:./dev.db` means `calendar/prisma/dev.db` |
| `APP_URL` | Your public https URL — Google OAuth redirect, MCP OAuth metadata, push |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Google tokens (strongly recommended) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Calendar sync |
| `SIGNUP_INVITE_CODE` | Require a code to sign up (set this on a public server) |
| `SMTP_*` | Password-reset and invite emails |
| `TZ` | Optional — otherwise the server runs in the owner's saved timezone |

## Example systemd unit

```ini
# /etc/systemd/system/season.service
[Unit]
Description=Season
After=network.target

[Service]
WorkingDirectory=/home/YOU/marvis/calendar
ExecStart=/usr/bin/npm start -- -p 3000
Restart=always
User=YOU
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Put a reverse proxy with HTTPS (Caddy is simplest: `season.example.com { reverse_proxy localhost:3000 }`)
in front — push notifications, the installable app, and claude.ai's connector
all require https.

## Upgrade notes

- **Prisma 7** (this release): the database URL moved from `schema.prisma`
  to `prisma.config.ts`, and the app now uses the `better-sqlite3` driver.
  Existing databases keep working unchanged (same file location, same
  date storage). `deploy.sh` handles the rest.
