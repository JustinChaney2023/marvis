# Document conversion setup (PDF syllabus import)

Marvis's syllabus importer reads `.txt`, `.md`, and `.docx` on its own, with
nothing to install. **PDF — the format most syllabi actually arrive in — and
other binary formats need this service.**

It wraps [markitdown](https://github.com/microsoft/markitdown) (Microsoft,
MIT), which converts PDF, PowerPoint, Word, Excel, HTML, EPUB, CSV and more
to Markdown. markitdown ships a CLI and an MCP server but no plain HTTP
endpoint, so `markitdown/server.py` is a small FastAPI wrapper exposing the
one thing Marvis needs: `POST /convert`.

Unlike the [Whisper setup](whisper-setup.md), this needs no GPU and no
model downloads. It is CPU-only and small — running it on the same machine
as Marvis is perfectly reasonable.

## What it will and won't do

| Input | Result |
|---|---|
| Text-based PDF (exported from Word, LaTeX, Google Docs) | Full text — the common case |
| PowerPoint, Word, Excel, HTML, EPUB, CSV | Full text |
| **Scanned PDF** (a photocopied handout) | **Little or nothing** |
| **Photo of a syllabus** | **Little or nothing** — EXIF metadata only |

**There is no OCR.** markitdown extracts text that already exists inside a
document; it does not read pixels. Its optional OCR plugin requires an LLM
vision client, which this service deliberately does not enable — output
would then depend on image contents in ways the caller can't predict, and
it would send documents to a third party. For a scanned syllabus, paste the
text instead.

## Quickstart

```bash
cd marvis/markitdown
docker compose up -d --build
```

First build takes a few minutes (`markitdown[all]` pulls every format
converter). Then verify:

```bash
curl http://localhost:8080/health
# {"status":"ok"}

curl -F "file=@syllabus.pdf" http://localhost:8080/convert | head -c 400
# {"markdown":"# BIOL 101 ..."}
```

Then in Marvis: **Settings → AI → Document conversion**, set the URL, click
**Test connection**, and save.

- Same machine as Marvis: `http://localhost:8080`
- Different machine, over Tailscale: `http://100.x.x.x:8080` — get the
  address with `tailscale ip -4` on the machine running the service.

Change the port with `MARKITDOWN_PORT=9000 docker compose up -d`.

## Security

This service parses **untrusted documents** with a large dependency tree,
and document parsers have a long history of CVEs. The container is
therefore unprivileged (`nobody`), drops all capabilities, blocks privilege
escalation, and runs with a read-only root filesystem and a `tmpfs` `/tmp`.
The wrapper writes uploads to a private temp file and calls markitdown's
narrowest entry point, never one that can fetch a URL — so a malicious
document cannot turn the service into an SSRF proxy.

**The port binds to `0.0.0.0`** so another machine can reach it. That also
exposes it to every network the host is on. If it's only for Tailscale,
restrict it — same reasoning and same commands as the
[Whisper security note](whisper-setup.md#security):

```bash
sudo ufw allow in on tailscale0 to any port 8080 proto tcp
sudo ufw deny 8080/tcp
```

If Marvis and the service run on the same machine, don't expose it at all —
change the port mapping in `compose.yaml` to `"127.0.0.1:8080:8080"`.

## Upgrading

Versions are pinned in `markitdown/Dockerfile` (currently
`markitdown[all]==0.1.7`). A PDF parser silently changing behaviour under a
working import is a data bug, not an improvement, so bump it deliberately:

```bash
cd marvis/markitdown
# edit the pinned version in Dockerfile
docker compose up -d --build
```

## Troubleshooting

**`Couldn't reach the document converter`** — the service isn't running or
the address is wrong. Check `docker compose ps` and `curl .../health` from
*the machine running Marvis*, not just the one running the service; over
Tailscale a firewall rule is the usual culprit.

**`No text found`** on a PDF that clearly has text — it's a scan. Confirm by
trying to select text in a PDF viewer. If you can't, neither can markitdown.

**`Reached ..., but it didn't return JSON`** — the URL points at something
else (a different service, or a reverse proxy returning an error page).

**Import works for `.docx` but not `.pdf`** — expected when no URL is
configured. `.docx` is handled in-process by Marvis and never touches this
service.

**Build fails pulling packages** — `markitdown[all]` needs network access at
build time. Behind a proxy, configure Docker's build proxy settings.

**Large PDF times out** — the client gives up after 2 minutes. Very large or
complex documents may exceed that; split the file or paste the relevant
section.
