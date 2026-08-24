# Local Whisper setup (lecture & meeting transcription)

Marvis transcribes recordings by calling an OpenAI-compatible
`POST /v1/audio/transcriptions` endpoint. Anything implementing that API
works — this guide covers running your own on a desktop with an NVIDIA GPU,
which is the setup worth having if you record lectures regularly: it's free
per-hour, and the audio never leaves your network.

The server is [speaches](https://github.com/speaches-ai/speaches) (formerly
`faster-whisper-server`). It wraps `faster-whisper` and exposes both
`/v1/audio/transcriptions` and `/v1/models`, which is what Marvis's model
dropdown reads.

The typical layout: **Whisper runs on the desktop, Marvis runs on the
laptop, Tailscale connects them.**

## Prerequisites (GPU path)

1. **NVIDIA driver** — check with `nvidia-smi`. If that command doesn't
   work, nothing below will either.
2. **NVIDIA Container Toolkit** — this is *separate from the driver* and is
   the single most common reason a GPU setup silently runs on CPU. Install
   per
   [NVIDIA's guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
   then confirm Docker itself can see the GPU:

   ```bash
   docker run --rm --gpus all ubuntu nvidia-smi
   ```

   If that prints your GPU, you're set. If it errors, fix this before
   continuing.
3. **Docker** with Compose v2 (`docker compose version`).

## Quickstart

On the machine with the GPU:

```bash
cd marvis/whisper
./setup.sh
docker compose up -d
```

`setup.sh` detects your GPU and VRAM, picks a model and compute type, and
writes `.env`. It prints the exact values to paste into Marvis afterward.
Re-run it any time to re-detect.

The first start downloads the model — several GB, so it takes a while.
Watch it:

```bash
docker compose logs -f
```

The download is cached in a named Docker volume, so restarts are fast.

## Point Marvis at it

In Marvis: **Settings → AI**, transcription section.

| Field | Value |
| --- | --- |
| Transcription URL | `http://<desktop-tailscale-ip>:8000/v1` |
| Transcription model | whatever `setup.sh` printed |
| API key | leave blank |

Get the Tailscale IP by running this **on the desktop**:

```bash
tailscale ip -4
```

Use that address, not `localhost` — `localhost` on the laptop means the
laptop. Then hit **Test connection** in Marvis; it queries `/v1/models` and
lists what the server actually has.

## Verify it works

From the laptop, to prove the network path and the API both work:

```bash
# Should list available models
curl http://<desktop-tailscale-ip>:8000/v1/models

# Real transcription, using any short audio file you have
curl -s http://<desktop-tailscale-ip>:8000/v1/audio/transcriptions \
  -F "file=@sample.m4a" \
  -F "model=Systran/faster-whisper-small"
```

No audio handy? Record five seconds: `arecord -d 5 -f cd sample.wav`.

## Security: this port is exposed

The container binds `0.0.0.0:8000` so the laptop can reach it. That also
exposes it to **every other network the desktop is on** — including café
wifi. There's no authentication by default.

Restrict it to Tailscale only:

```bash
# Preferred — only the Tailscale interface
sudo ufw allow in on tailscale0 to any port 8000 proto tcp

# Alternative — the Tailscale CGNAT range
sudo ufw allow from 100.64.0.0/10 to any port 8000 proto tcp
```

Make sure you haven't also opened 8000 broadly (`sudo ufw status`).

If you'd rather add auth, speaches supports an `API_KEY` env var; set it in
`whisper/.env`, add it to the `environment:` block in `compose.yaml`, and
put the same value in Marvis's API key field.

## Which model

`setup.sh` picks for you, but to override, edit `WHISPER_MODEL` in
`whisper/.env`:

| VRAM | Model | Compute | Notes |
| --- | --- | --- | --- |
| ≥ 10 GB | `deepdml/faster-whisper-large-v3-turbo-ct2` | `float16` | Best default. 809M params vs large-v3's 1550M at close to the same accuracy. |
| 6–10 GB | `Systran/faster-distil-whisper-large-v3` | `float16` | Distilled large-v3; noticeably faster, slight accuracy cost. |
| 4–6 GB | `Systran/faster-whisper-small` | `float16` | Weaker on proper nouns and jargon. |
| < 4 GB or CPU | `Systran/faster-whisper-base` | `int8` | Fallback. Expect errors on technical terms. |

Worth knowing before you chase a bigger model: **on lecture audio,
accuracy is dominated by microphone quality and room acoustics, not model
size.** A decent mic near the speaker with `small` will beat a laptop mic at
the back of a hall with `large-v3`. If transcripts are disappointing, try a
better recording setup before a heavier model.

Marvis also feeds course context (instructor name, textbook titles, lecture
topics from your syllabus) to the transcriber, which helps with exactly the
proper nouns Whisper otherwise mangles. This only applies to recordings
attached to a project or event — a standalone recording has no context to
draw on. The same terms are given to the model that writes your notes, so
anything Whisper still garbles gets spelled correctly there.

`STT_MODEL_TTL=-1` in the generated `.env` keeps the model loaded so every
recording doesn't pay the load cost again. If you need that VRAM back for
other work, set it to `300` (unload after five idle minutes).

## Native install (no Docker)

Docker is the recommended path — this one is genuinely fiddlier, mainly
because you own the CUDA and cuDNN versions yourself, and `faster-whisper`
is particular about them. Use it if you'd rather not run Docker.

Requires [`uv`](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/speaches-ai/speaches.git
cd speaches
uv python install
uv venv
source .venv/bin/activate
uv sync
uvicorn --factory --host 0.0.0.0 speaches.main:create_app
```

Configure it with the same environment variables the compose file uses,
e.g.:

```bash
export WHISPER__COMPUTE_TYPE=float16
export STT_MODEL_TTL=-1
```

To keep it running after you log out, a systemd **user** unit at
`~/.config/systemd/user/speaches.service` — replace `%h/speaches` if you
cloned elsewhere:

```ini
[Unit]
Description=speaches (Whisper server for Marvis)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=%h/speaches
Environment=WHISPER__COMPUTE_TYPE=float16
Environment=STT_MODEL_TTL=-1
ExecStart=%h/speaches/.venv/bin/uvicorn --factory --host 0.0.0.0 --port 8000 speaches.main:create_app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now speaches
# so it starts before you log in
sudo loginctl enable-linger "$USER"
```

## Hosted alternative

If you'd rather not run a server, point Marvis at any hosted service
implementing the same endpoint. OpenAI's own Whisper API does
(`https://api.openai.com/v1`, model `whisper-1`, plus an API key).

Before assuming another provider works, confirm it actually exposes
`/v1/audio/transcriptions` — plenty of providers offer text and
text-to-speech without offering OpenAI-compatible speech-to-text.

## Troubleshooting

**Container can't see the GPU / it's using CPU.** Run
`docker run --rm --gpus all ubuntu nvidia-smi`. If that fails, the NVIDIA
Container Toolkit isn't installed or Docker wasn't restarted after
installing it (`sudo systemctl restart docker`).

**Model download is slow or stalls.** It's several GB from HuggingFace.
`docker compose logs -f` shows progress. It's cached afterward, so this is
a one-time cost per model.

**Laptop can't reach the desktop.** Check `tailscale status` on both ends.
Verify the server is up locally on the desktop first
(`curl localhost:8000/v1/models`) — that separates "server is down" from
"network path is blocked". If local works but remote doesn't, it's the
firewall.

**Out of memory.** Drop one tier in the table above, or switch
`WHISPER_COMPUTE_TYPE` from `float16` to `int8`. Remember the GPU is also
driving your display.

**401 from the server.** An `API_KEY` is set on the server but not in
Marvis (or they don't match).

**Marvis's model dropdown is empty.** The endpoint URL is wrong or
unreachable. It must end in `/v1`. Use **Test connection** — it
distinguishes unreachable from auth-failed from not-OpenAI-compatible.
