"""The analysis sidecar's HTTP surface.

Two endpoints, documented in README.md, which is the contract rather than a
description of this file. Anything answering them is a valid analyzer.

Everything here is plumbing: fetch-and-decode, classify a failure, size the
worker pool. The measurement itself is `measure.py`, which touches neither HTTP
nor a subprocess so it can be exercised against a synthetic signal.
"""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from measure import SAMPLE_RATE, SCHEMA_VERSION, measure

ANALYZER = "deadair-analysis/0.1.0"

# How many tracks decode at once. One by default because this is CPU-bound and
# an operator who has not thought about it should not have their machine taken
# over by a background walk.
#
# Its counterpart is the station's `analysis.concurrency`, and NEITHER CAN
# COMPUTE THE OTHER: this service owns the CPU so it sizes the pool, the station
# owns the walk so it decides how many requests are in flight. Deriving one from
# the other would need the app to know this container's hardware, which it
# cannot -- `baseUrl` may point at a different machine entirely.
WORKERS = max(1, int(os.environ.get("ANALYSIS_WORKERS", "1")))

PORT = int(os.environ.get("ANALYSIS_PORT", "9321"))

# Refuse audio longer than this rather than decode it. A rundown item is a
# record; anything half an hour long is a mistake somewhere upstream (a live
# stream URL, a whole DJ set, a redirect to something that is not the track) and
# decoding it would tie up a worker for minutes to measure something nothing
# will play.
MAX_SECONDS = int(os.environ.get("ANALYSIS_MAX_SECONDS", "1800"))

# Below this ratio of the caller's claimed duration, what came back is a
# truncation rather than a short track. Not 1.0: encoder padding, a container
# whose header rounds, and a provider that reports the tagged length rather than
# the decoded one all produce small honest discrepancies.
COMPLETE_RATIO = 0.98

app = FastAPI(title="deadair analysis")

# Bounded, and the semaphore is what actually bounds it -- FastAPI would happily
# accept a hundred concurrent requests and hand them all to the pool's queue,
# which turns a concurrency limit into a memory limit instead.
_pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="analyze")
_slots = asyncio.Semaphore(WORKERS)


class AnalyzeRequest(BaseModel):
    url: str
    durationMs: int | None = None


class AnalysisError(Exception):
    """A failure with a code the station knows how to record."""

    def __init__(self, code: str, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass(frozen=True)
class Decoded:
    samples: np.ndarray
    duration_ms: int


# ffmpeg says why it failed in prose, so the classification is a prose match.
# Deliberately conservative: anything unrecognised stays `undecodable`, which is
# recorded against the track and retried in a day, rather than `unfetchable`,
# which would suggest the address is wrong when it may not be.
_UNFETCHABLE = re.compile(
    r"(server returned \d|connection refused|name or service not known|no route to host|"
    r"protocol not found|http error|failed to resolve|connection timed out|403 forbidden|404 not found)",
    re.IGNORECASE,
)


def _decode(url: str) -> Decoded:
    """Fetch and decode to mono float32 at SAMPLE_RATE.

    ffmpeg does the fetching as well as the decoding, which is why `complete` can
    be answered at all: one process either delivered the whole stream or did not,
    and its exit status says which. Splitting the two would mean holding the
    encoded file somewhere to hand over, for no gain.
    """
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        # Bound the read at the source. Without this a stream URL never ends and
        # the worker never comes back.
        "-t", str(MAX_SECONDS),
        "-i", url,
        "-vn",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-f", "f32le",
        "-",
    ]

    try:
        finished = subprocess.run(command, capture_output=True, check=False)
    except FileNotFoundError as error:  # pragma: no cover - a broken image, not a bad track
        raise AnalysisError("internal", "ffmpeg is not installed in this image", status=500) from error

    stderr = finished.stderr.decode("utf-8", errors="replace").strip()

    if finished.returncode != 0:
        code = "unfetchable" if _UNFETCHABLE.search(stderr) else "undecodable"
        raise AnalysisError(code, stderr[:500] or f"ffmpeg exited {finished.returncode}")

    samples = np.frombuffer(finished.stdout, dtype=np.float32)
    if samples.size == 0:
        # A clean exit with no samples is a URL that served something ffmpeg was
        # willing to open and that contained no audio -- an HTML error page with
        # a 200, most often.
        raise AnalysisError("undecodable", "the URL served no audio")

    return Decoded(samples=samples, duration_ms=int(samples.size * 1000 / SAMPLE_RATE))


def _analyze(url: str, claimed_ms: int | None) -> dict:
    decoded = _decode(url)
    points = measure(decoded.samples, SAMPLE_RATE)

    # Truncation is a judgement about the DOWNLOAD, so it is made here rather
    # than in `measure`, which is handed samples and has no way to know whether
    # more were meant to follow.
    complete = True
    if claimed_ms is not None and claimed_ms > 0:
        complete = decoded.duration_ms >= claimed_ms * COMPLETE_RATIO

    return {
        "schemaVersion": SCHEMA_VERSION,
        "analyzer": ANALYZER,
        "complete": complete,
        "durationMs": decoded.duration_ms,
        "data": points.as_data(),
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "schemaVersion": SCHEMA_VERSION, "analyzer": ANALYZER, "workers": WORKERS}


@app.post("/analyze")
async def analyze(request: AnalyzeRequest) -> JSONResponse:
    if not request.url.strip():
        return _error(AnalysisError("unfetchable", "no url given", status=400))

    async with _slots:
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(_pool, _analyze, request.url, request.durationMs)
        except AnalysisError as error:
            return _error(error)
        except Exception as error:  # noqa: BLE001 - the boundary; nothing above this catches
            return _error(AnalysisError("internal", str(error)[:500], status=500))

    return JSONResponse(result)


def _error(error: AnalysisError) -> JSONResponse:
    return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
