@AGENTS.md

## Season context card

Before starting work, read
`~/marvis/marvis-vault/02 Active Projects/Season - Context Card.md` in
full. It holds current state, next actions, blockers, and recent decisions
— do not ask the user to restate anything it already covers; ask only about
what has changed since `updated`. If the file does not exist, or its
`review_due` date has passed, see
`~/marvis/marvis-spec/specs/2026-08-27-vault-cross-session-hub-phase-1-context-card.md`
Section 5.3 for what to do. At the end of a completed unit of work, or at
session end, update the card per that spec's Section 5.2 — don't wait to be
asked.

## Deployment

`https://useseason.app` is served by **`season-prod`** (192.168.20.253, a
Proxmox LXC on Proxmox node `keystone`, VLAN 20 DMZ) — **not** pilot. Pilot
is dev-only now: edit and test here with `npm run dev` (briefly — see the
memory on why long-running dev mode OOMs this laptop), then deploy.

**To deploy:** `./scripts/deploy-season-prod.sh`. It rsyncs the working
tree (code only — never `.env`, `var/uploads`, or `prisma/dev.db`, which
are prod state) to `/opt/season` on season-prod, then runs `npm ci` →
`prisma generate` → `prisma migrate deploy` → `npm run build` → `pm2
restart season-calendar`, then curls both the local and public URL to
confirm it came back up. Requires `ip route add 192.168.20.0/24 via
192.168.8.1 dev wlp0s20f3` on pilot first if the route isn't already
present (see the season-prod-migration memory — a stray Docker network on
pilot swallows that subnet in the routing table, and the fix isn't
persisted across reboots).

The app on season-prod runs as a dedicated `season` system user, not root —
`su -s /bin/bash season -c '...'` with `PM2_HOME=/home/season/.pm2` for any
manual pm2 command there.

Schema changes: write the Prisma migration locally as usual
(`npx prisma migrate dev`), commit the generated migration folder, then
`deploy-season-prod.sh` applies it on season-prod via `migrate deploy`
(non-interactive, safe for the already-running prod DB).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
