# markitdown + a minimal HTTP wrapper for Marvis.
#
# Built locally rather than pulled: Microsoft publishes a Dockerfile but no
# image, and theirs is CLI-only (ENTRYPOINT ["markitdown"]) with no HTTP
# server. Versions are pinned so a rebuild months from now behaves the same.
FROM python:3.13-slim-bookworm

# exiftool backs image/audio metadata extraction; ffmpeg backs audio.
# Both are what markitdown's own Dockerfile installs.
ENV DEBIAN_FRONTEND=noninteractive \
    EXIFTOOL_PATH=/usr/bin/exiftool \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      exiftool \
    && rm -rf /var/lib/apt/lists/*

# [all] pulls every format converter (pdf, pptx, xlsx, xls, outlook, ...).
# Pinning the exact versions matters more than being current here: a PDF
# parser changing behaviour under a working import is a silent data bug.
RUN pip install --no-cache-dir \
      "markitdown[all]==0.1.7" \
      "fastapi==0.115.6" \
      "uvicorn[standard]==0.34.0" \
      "python-multipart==0.0.20"

WORKDIR /app
COPY server.py /app/server.py

# Unprivileged: this parses untrusted documents with a large dependency
# tree, and document parsers have a long CVE history.
USER nobody:nogroup

EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
