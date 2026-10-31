#!/usr/bin/env bash
# Deploys the working tree at ~/marvis/calendar (pilot, dev) to season-prod
# (192.168.20.253, the live host behind https://useseason.app).
#
# One-way: pushes code only. Never touches season-prod's .env, var/uploads,
# or prisma/dev.db — those are prod state, not build artifacts. Likewise
# public/ort + public/models (gitignored whisper assets from `npm run
# setup:whisper`): a clean checkout lacks them and --delete would wipe them.
set -euo pipefail

HOST=root@192.168.20.253
REMOTE_DIR=/opt/season
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> syncing code to season-prod"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude .env --exclude .env.local \
  --exclude var/uploads --exclude 'prisma/dev.db*' \
  --exclude public/ort --exclude public/models \
  --exclude .claude \
  "$REPO_DIR"/ "$HOST":"$REMOTE_DIR"/

echo "==> installing deps, migrating, building on season-prod"
ssh "$HOST" "chown -R season:season $REMOTE_DIR && su -s /bin/bash season -c '
  set -e
  cd $REMOTE_DIR
  npm ci --silent
  npx prisma generate
  npx prisma migrate deploy
  npm run build
'"

echo "==> restarting season-calendar"
ssh "$HOST" "su -s /bin/bash season -c 'PM2_HOME=/home/season/.pm2 pm2 restart season-calendar'"

echo "==> verifying"
sleep 2
ssh "$HOST" "curl -s -o /dev/null -m 8 -w 'local http %{http_code}\n' http://localhost:3000/"
curl -s -L -o /dev/null --max-time 15 -w "public https://useseason.app -> %{http_code}\n" https://useseason.app/
