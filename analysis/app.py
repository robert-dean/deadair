"""The analysis sidecar's HTTP surface.

Two endpoints, documented in README.md, which is the contract rather than a
description of this file. Anything answering them is a valid analyzer.

Everything here is plumbing: fetch-and-decode, classify a failure, size the
worker pool. The measurement itself is `measure.py`, which touches neither HTTP
nor a subprocess so it can be exercised against a synthetic signal.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from loudness import integrated_lufs, sample_peak_db, to_mono, true_peak_db
from measure import SAMPLE_RATE, SCHEMA_VERSION, measure
from tags import gain_tags

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

# How long to wait on the audio fetch. Generous: this is a whole track over
# whatever the provider's fetcher manages, not an API call.
FETCH_TIMEOUT_S = int(os.environ.get("ANALYSIS_FETCH_TIMEOUT_S", "180"))

# Refuse anything larger rather than fill the container's disk. A lossless
# half-hour master is comfortably inside this; a redirect to something that is
# not a track is not.
MAX_BYTES = int(os.environ.get("ANALYSIS_MAX_BYTES", str(512 * 1024 * 1024)))

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
    """`(frames, channels)` float32, at REFERENCE_RATE."""

    samples: np.ndarray
    duration_ms: int


# Channels are kept up to stereo and folded down above that.
#
# Keeping them is not a nicety: BS.1770 sums the weighted power of each channel,
# so measuring a downmix reads about 3 dB low on uncorrelated material and
# nothing at all on anti-phase material. Both were measured against ffmpeg's own
# implementation before this was written.
#
# Anything wider than stereo is folded to stereo rather than measured with the
# surround weights the standard defines (1.41 for the rear pair). A music
# station's catalog is stereo, the fold is what a listener on this mount would
# hear anyway, and implementing weights against material nobody here can test
# would be worse than the documented compromise.
MAX_CHANNELS = 2


# ffmpeg says why it failed in prose, so the classification is a prose match.
# Deliberately conservative: anything unrecognised stays `undecodable`, which is
# recorded against the track and retried in a day, rather than `unfetchable`,
# which would suggest the address is wrong when it may not be.
_UNFETCHABLE = re.compile(
    r"(server returned \d|connection refused|name or service not known|no route to host|"
    r"protocol not found|http error|failed to resolve|connection timed out|403 forbidden|404 not found)",
    re.IGNORECASE,
)


def _download(url: str) -> tuple[str, bool]:
    """Fetch the audio ONCE to a temp file. Returns the path and whether it is whole.

    **The one fetch is the point.** Handing a URL to ffprobe and then to ffmpeg
    made each of them open it over HTTP and seek within it, and a container format
    wants the header and the trailer — measured against the real track fetcher,
    that came to EIGHT requests for a nine-megabyte file, per track. Every one of
    those crosses the provider's rate limits on the same credential the station
    plays on, which is exactly the traffic the caller's pacing exists to bound.
    One download and two local reads is the same measurement for an eighth of the
    cost.

    It also makes `complete` something this service can answer honestly rather
    than infer. Comparing what arrived against `Content-Length` catches a
    truncated transfer directly, where a duration comparison can only catch one
    big enough to shorten the decode.
    """
    handle = tempfile.NamedTemporaryFile(suffix=".audio", delete=False)
    received = 0
    declared: int | None = None

    try:
        request = urllib.request.Request(url, headers={"user-agent": ANALYZER})
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_S) as response:
            length = response.headers.get("content-length")
            declared = int(length) if length and length.isdigit() else None

            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                received += len(chunk)
                if received > MAX_BYTES:
                    raise AnalysisError("undecodable", f"audio is over the {MAX_BYTES} byte limit")
                handle.write(chunk)
    except AnalysisError:
        handle.close()
        os.unlink(handle.name)
        raise
    except urllib.error.HTTPError as error:
        handle.close()
        os.unlink(handle.name)
        raise AnalysisError("unfetchable", f"HTTP {error.code} from the audio url") from error
    except Exception as error:  # noqa: BLE001 - urllib raises a wide family here
        handle.close()
        os.unlink(handle.name)
        raise AnalysisError("unfetchable", str(error)[:300]) from error
    finally:
        if not handle.closed:
            handle.close()

    if received == 0:
        os.unlink(handle.name)
        raise AnalysisError("unfetchable", "the audio url served no bytes")

    # A short read against a declared length is a truncation, full stop. Absent a
    # Content-Length the caller's duration check is still the backstop.
    whole = declared is None or received >= declared
    return handle.name, whole


@dataclass(frozen=True)
class Probed:
    """What the container says about itself, before a sample is decoded."""

    channels: int
    tags: dict[str, str]


def _probe(path: str) -> Probed:
    """The channel count and the file's tags, in one ffprobe.

    ONE probe, deliberately. The channel count is what the decode is reshaped
    against and the tags are what the file already claims about its own loudness,
    and they arrive from the same header read -- so asking twice would double the
    cost of the cheapest step here for no reason. See `_download` for what
    happened the last time this file opened the same audio more than once.

    A local read, so it costs a stat and a header parse rather than a network
    round trip. Falls back to mono with no tags on anything unexpected: a wrong
    low guess measures one channel of a stereo file, which is a plausible figure,
    where a wrong high guess reshapes the buffer and produces nonsense.

    Format tags and stream tags are merged with the stream winning, because which
    of the two carries ReplayGain depends on the container -- Vorbis comments in
    a FLAC surface as format tags, an Opus `R128_TRACK_GAIN` as stream tags -- and
    a file that somehow carries both is describing its audio stream more
    specifically in the latter.
    """
    command = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=channels:stream_tags:format_tags",
        "-of", "json",
        path,
    ]
    try:
        finished = subprocess.run(command, capture_output=True, check=False, timeout=60)
        parsed = json.loads(finished.stdout.decode() or "{}")
    except (ValueError, OSError, subprocess.SubprocessError):
        return Probed(channels=1, tags={})

    streams = parsed.get("streams") or [{}]
    stream = streams[0] if isinstance(streams[0], dict) else {}

    try:
        channels = max(1, min(MAX_CHANNELS, int(stream.get("channels") or 1)))
    except (TypeError, ValueError):
        channels = 1

    tags = {**_tag_section(parsed.get("format")), **_tag_section(stream)}

    return Probed(channels=channels, tags=tags)


def _tag_section(section: object) -> dict[str, str]:
    """One `tags` object as a flat string dictionary, or nothing."""
    if not isinstance(section, dict):
        return {}

    tags = section.get("tags")
    if not isinstance(tags, dict):
        return {}

    return {str(key): value for key, value in tags.items() if isinstance(value, str)}


def _decode(path: str, channels: int) -> Decoded:
    """Decode a LOCAL file to float32 at SAMPLE_RATE, keeping up to MAX_CHANNELS.

    Takes a path rather than a url so the fetch happens once, in `_download`. See
    the note there: letting ffprobe and ffmpeg each open the url cost eight HTTP
    requests per track against the station's own provider credential. It takes the
    channel count rather than probing for it for the same reason at smaller scale:
    `_probe` runs once, in `_analyze`, and its other half is the file's tags.
    """
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        # Bound the read at the source. Without this a stream URL never ends and
        # the worker never comes back.
        "-t", str(MAX_SECONDS),
        "-i", path,
        "-vn",
        "-ac", str(channels),
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

    flat = np.frombuffer(finished.stdout, dtype=np.float32)
    if flat.size == 0:
        # A clean exit with no samples is a URL that served something ffmpeg was
        # willing to open and that contained no audio -- an HTML error page with
        # a 200, most often.
        raise AnalysisError("undecodable", "the URL served no audio")

    # Interleaved, so a partial final frame would shear every channel. Trimming
    # it is a fraction of a millisecond; not trimming it is silent corruption.
    frames = flat.size // channels
    samples = flat[: frames * channels].reshape(frames, channels)

    return Decoded(samples=samples, duration_ms=int(frames * 1000 / SAMPLE_RATE))


def _analyze(url: str, claimed_ms: int | None) -> dict:
    path, whole_transfer = _download(url)

    try:
        probed = _probe(path)
        decoded = _decode(path, probed.channels)
    finally:
        # Always, including on a decode failure: a worker that leaves its
        # downloads behind fills the container's disk over a library-sized walk.
        try:
            os.unlink(path)
        except OSError:
            pass

    # The cue points want one signal and the loudness wants the channels. Folded
    # here rather than at the decode, because folding for BOTH is the mistake
    # that reads 3 dB low on real stereo -- see `integrated_lufs`.
    points = measure(to_mono(decoded.samples), SAMPLE_RATE)

    # Measured over the WHOLE file rather than between the cue points. Loudness
    # is a property of the record as delivered, and the gate already discards the
    # silence at either end -- trimming first would gate it twice and, on a track
    # that fades to nothing, would move the figure by a fraction of a decibel for
    # no reason anyone could reconstruct later.
    # The tags go in beside the measurement rather than instead of it, and both
    # are reported whatever they say. Deciding between them is the station's job:
    # it holds the target, so it is the only place that can turn a tagged
    # correction back into a level. See `tags.py`.
    data = {
        **points.as_data(),
        **_loudness_of(decoded.samples),
        **gain_tags(probed.tags),
    }

    # Two independent truths, and the answer is complete only if BOTH hold.
    #
    # `whole_transfer` is what the download saw: bytes received against the
    # declared length, which catches a cut connection exactly. The duration check
    # is what the DECODE saw, which catches a file that arrived whole and is
    # short anyway -- a provider serving a preview clip, say, where the transfer
    # is perfectly complete and the audio is not the track.
    #
    # Neither subsumes the other, so neither is dropped.
    complete = whole_transfer
    if claimed_ms is not None and claimed_ms > 0:
        complete = complete and decoded.duration_ms >= claimed_ms * COMPLETE_RATIO

    return {
        "schemaVersion": SCHEMA_VERSION,
        "analyzer": ANALYZER,
        "complete": complete,
        "durationMs": decoded.duration_ms,
        "data": data,
    }


def _loudness_of(samples: np.ndarray) -> dict:
    """The loudness fields, omitting any the signal cannot support.

    Omitted rather than sent as a floor value, because these feed a gain
    calculation: a silent track reported at -80 LUFS would be "corrected" by
    fifty-odd decibels, where an absent figure is the no-opinion every consumer
    of these measurements already knows how to handle.
    """
    fields = {
        "integratedLufs": integrated_lufs(samples),
        "truePeakDb": true_peak_db(samples),
        "samplePeakDb": sample_peak_db(samples),
    }
    return {key: round(value, 2) for key, value in fields.items() if value is not None}


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
