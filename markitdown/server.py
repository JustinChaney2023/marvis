"""Minimal HTTP wrapper around markitdown.

markitdown ships a CLI and an MCP server, but no plain HTTP endpoint, and
Marvis is a Node app that just needs "POST a file, get markdown back".
That gap is this file. Deliberately tiny — routing, size limits, and format
decisions all live in the Node app; this only converts.

Security: markitdown's own README warns it performs I/O with the calling
process's privileges and to use the narrowest convert_* entry point. We
write to a private temp file and call convert() on that path, never
convert_uri(), so a malicious document can't talk us into fetching a URL.
The container also runs unprivileged — see compose.yaml.
"""

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from markitdown import MarkItDown

# Bounded here as well as in the Node caller: this service may be reachable
# on the LAN/tailnet, so it cannot rely on a well-behaved client.
MAX_BYTES = int(os.environ.get("MARKITDOWN_MAX_BYTES", 25 * 1024 * 1024))

app = FastAPI(title="marvis-markitdown", version="1")

# enable_plugins is off: the OCR plugin needs an LLM client to do anything,
# and silently loading plugins would make output depend on image contents
# in ways the caller can't predict. Plain, offline, deterministic.
_md = MarkItDown(enable_plugins=False)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)) -> dict[str, str]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_BYTES} bytes.")

    # Extension drives converter selection, so keep it — but take only the
    # suffix of the client-supplied name, never the name itself, so a
    # "../../etc/passwd" filename can't escape the temp directory.
    suffix = Path(file.filename or "").suffix[:16]

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        result = _md.convert(tmp_path)
    except Exception as exc:  # noqa: BLE001 - surface the reason, don't 500 blindly
        raise HTTPException(status_code=422, detail=f"Could not convert: {exc}") from exc
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)

    text = getattr(result, "markdown", None) or getattr(result, "text_content", "") or ""
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail=(
                "No text found. Scanned PDFs and photos need OCR, which this "
                "service does not perform — see docs/markitdown-setup.md."
            ),
        )
    return {"markdown": text}
