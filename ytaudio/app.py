"""The audio-url sidecar's HTTP surface.

Two endpoints, and README.md is the contract rather than this file. Anything
answering them is a valid resolver.

Everything here is plumbing: classify a failure, keep one resolve off another's
toes. It holds no credential. Every resolve is signed out, for the reason given
on `resolve.resolve`, so the operator's cookie never reaches this process. The
resolving itself is `resolve.py`, which touches no HTTP so it can be exercised
against a stub.
"""

from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from resolve import ResolveError, Unavailable, resolve

app = FastAPI(title="deadair ytaudio", docs_url=None, redoc_url=None)

# yt-dlp is synchronous and spends its time waiting on the network. A small pool
# keeps one slow resolve from stalling the others without letting the station
# open an unbounded number of connections to one upstream.
_WORKERS = int(os.environ.get("YTAUDIO_WORKERS", "4"))
_pool = ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="resolve")


class ResolveBody(BaseModel):
    videoId: str


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


#: How a resolver failure reads to the station. The station's own vocabulary is
#: the plugin's business; these are the facts it maps from. `unavailable` is the
#: one that means "stop asking", and it is answered as 410 for the same reason the
#: Spotify shim does: the caller writes the copy off rather than retrying.
_STATUS = {
    "unavailable": 410,
    # The record plays only to an account, and a resolve never has one. Final for
    # this record, so not a 5xx the caller might retry.
    "needs-account": 403,
    "refused": 502,
    "cooling": 503,
    "upstream": 502,
}


@app.post("/resolve")
async def post_resolve(body: ResolveBody) -> JSONResponse:
    video_id = body.videoId.strip()
    if not video_id:
        return JSONResponse(status_code=400, content={"code": "config", "message": "videoId is required"})

    loop = asyncio.get_running_loop()
    try:
        found = await loop.run_in_executor(_pool, lambda: resolve(video_id))
    except Unavailable as error:
        return JSONResponse(status_code=410, content={"code": error.code, "message": error.message})
    except ResolveError as error:
        return JSONResponse(status_code=_STATUS.get(error.code, 502), content={"code": error.code, "message": error.message})

    return JSONResponse(
        content={
            "url": found.url,
            "expiresAt": found.expires_at_ms,
            "mimeType": found.mime_type,
            "itag": found.itag,
            "durationMs": found.duration_ms,
            "filesize": found.filesize,
        }
    )
