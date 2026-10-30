#!/usr/bin/env bash
# Update a running Season install in place: back up the database, pull,
# install, migrate, build, restart. Run from anywhere on the server:
#   bash calendar/scripts/deploy.sh            # deploys origin/main
#   BRANCH=my-branch bash calendar/scripts/deploy.sh
# Restart: set SEASON_RESTART_CMD (e.g. "sudo systemctl restart season" or
# "pm2 restart season"); otherwise it tries a systemd unit or pm2 process
# named "season", and if neither exists it tells you to restart by hand.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
BRANCH="${BRANCH:-main}"
cd "$APP_DIR"

# DATABASE_URL from .env (relative file: paths live under prisma/ — see
# src/lib/databaseUrl.ts).
DB_URL="$(grep -E '^DATABASE_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
DB_URL="${DB_URL:-file:./dev.db}"
DB_PATH="${DB_URL#file:}"
[[ "$DB_PATH" = /* ]] || DB_PATH="$APP_DIR/prisma/${DB_PATH#./}"

if [[ -f "$DB_PATH" ]]; then
  mkdir -p "$APP_DIR/backups"
  BACKUP="$APP_DIR/backups/$(basename "$DB_PATH").$(date +%Y%m%d-%H%M%S)"
  # sqlite3 .backup is safe while the app is running; plain cp is the fallback.
  if command -v sqlite3 >/dev/null; then sqlite3 "$DB_PATH" ".backup '$BACKUP'"; else cp "$DB_PATH" "$BACKUP"; fi
  echo "==> Database backed up to $BACKUP"
  ls -1t "$APP_DIR/backups" | tail -n +15 | sed "s|^|$APP_DIR/backups/|" | xargs -r rm -f
fi

echo "==> Pulling $BRANCH"
git -C "$REPO_DIR" fetch origin "$BRANCH"
git -C "$REPO_DIR" checkout "$BRANCH"
git -C "$REPO_DIR" pull --ff-only origin "$BRANCH"

echo "==> Installing dependencies"
npm ci
echo "==> Migrating database"
npx prisma generate
npx prisma migrate deploy
echo "==> Building"
npm run build

echo "==> Restarting"
if [[ -n "${SEASON_RESTART_CMD:-}" ]]; then
  eval "$SEASON_RESTART_CMD"
elif systemctl list-unit-files 2>/dev/null | grep -q '^season\.service'; then
  sudo systemctl restart season
elif command -v pm2 >/dev/null && pm2 describe season >/dev/null 2>&1; then
  pm2 restart season
else
  echo "!! No SEASON_RESTART_CMD, systemd unit, or pm2 process named 'season' — restart the server yourself (npm start)."
fi
echo "==> Done."
