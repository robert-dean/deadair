"""The audio-url sidecar's HTTP surface.

Three endpoints, and README.md is the contract rather than this file. Anything
answering them is a valid resolver.

Everything here is plumbing: hold the operator's session, classify a failure,
keep one resolve off another's toes. The resolving itself is `resolve.py`, which
touches no HTTP so it can be exercised against a stub.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from cookies import looks_signed_in, to_netscape
from resolve import ResolveError, Unavailable, resolve

app = FastAPI(title="deadair ytaudio", docs_url=None, redoc_url=None)

# yt-dlp is synchronous and spends its time waiting on the network. A small pool
# keeps one slow resolve from stalling the others without letting the station
# open an unbounded number of sessions against one upstream.
_WORKERS = int(os.environ.get("YTAUDIO_WORKERS", "4"))
_pool = ThreadPoolExecutor(max_workers=_WORKERS, thread_name_prefix="resolve")


class _Session:
    """The operator's cookie, written where yt-dlp can read it.

    Held in memory and on a file this process owns, never on the station's data
    volume: the authoritative copy is the plugin's own encrypted config, and this
    is a cache of it that should die with the process. Pushed rather than read
    from disk so there is exactly one place an operator pastes it.
    """

    def __init__(self) -> None:
        self._path: str | None = None

    @property
    def cookiefile(self) -> str | None:
        return self._path

    def set(self, header: str) -> None:
        handle = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
        try:
            os.chmod(handle.name, 0o600)
            handle.write(to_netscape(header))
        finally:
            handle.close()
        old, self._path = self._path, handle.name
        if old:
            try:
                os.unlink(old)
            except OSError:
                pass

    def clear(self) -> None:
        if self._path:
            try:
                os.unlink(self._path)
            except OSError:
                pass
        self._path = None


session = _Session()


class SessionBody(BaseModel):
    cookie: str


class ResolveBody(BaseModel):
    videoId: str


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "hasSession": session.cookiefile is not None}


@app.post("/session")
async def put_session(body: SessionBody) -> JSONResponse:
    """Hand this process the operator's session.

    A malformed paste is refused here, where the operator is standing in front of
    the settings card, rather than surfacing later as every record failing to
    resolve for no stated reason. It is NOT a credential check: a cookie can be
    perfectly well-formed and dead, and only a resolve can tell.
    """
    if not looks_signed_in(body.cookie):
        return JSONResponse(
            status_code=400,
            content={"code": "config", "message": "that does not look like a signed-in cookie header: no SID"},
        )
    session.set(body.cookie)
    return JSONResponse(content={"ok": True})


@app.delete("/session")
async def drop_session() -> dict:
    session.clear()
    return {"ok": True}


#: How a resolver failure reads to the station. The station's own vocabulary is
#: the plugin's business; these are the facts it maps from. `unavailable` is the
#: one that means "stop asking", and it is answered as 410 for the same reason the
#: Spotify shim does: the caller writes the copy off rather than retrying.
_STATUS = {
    "unavailable": 410,
    "auth": 401,
    # The account is real and will not serve us. Nothing retries past this, and
    # nothing the station does changes it -- only the operator's subscription.
    "premium": 402,
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
        found = await loop.run_in_executor(_pool, lambda: resolve(video_id, cookiefile=session.cookiefile))
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
