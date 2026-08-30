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
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from join import (
    MAX_GAP_MS,
    MAX_OFFSET_MS,
    MAX_OVERLAYS,
    MAX_PARTS,
    duration_ms,
    join_offsets,
    join_samples,
    place_overlay,
    trim_to_cues,
    with_headroom,
)
from loudness import integrated_lufs, sample_peak_db, to_downmix, to_mono, true_peak_db
from measure import SAMPLE_RATE, SCHEMA_VERSION, measure
from tags import gain_tags
from vocal import measure_vocals

ANALYZER = "deadair-analysis/0.1.0"

# The MOST this machine will ever decode at once, which is not the same thing as
# how many it decodes at once. The station's `analysis.concurrency` is the live
# number and it is the only knob an operator turns; this is the ceiling under
# which that number is free to move.
#
# The split is what makes the two settable from one place. The station cannot
# compute this -- `baseUrl` may name a machine with thirty-two cores or a
# Raspberry Pi -- so the machine keeps a veto; but expressed as a ceiling rather
# than as the operating value, a veto costs nothing until it is reached, where a
# pool pinned at 1 silently discarded every increase the console made and looked
# exactly like a setting that does not work.
#
# Four rather than the core count, and the reason is memory rather than CPU: a
# decode holds the whole record as float32 at the reference rate, so a
# five-minute track is ~115 MB resident before `to_mono` copies it, plus the
# downloaded file and ffmpeg's own buffer. On a sixteen-core box that would be
# several gigabytes of a machine that is usually also running Postgres, the app
# and the station.
WORKERS = max(1, int(os.environ.get("ANALYSIS_WORKERS", str(min(4, os.cpu_count() or 1)))))

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

# Bounded at the ceiling, and the semaphore is what actually bounds it -- FastAPI
# would happily accept a hundred concurrent requests and hand them all to the
# pool's queue, which turns a concurrency limit into a memory limit instead. A
# caller asking for fewer than this simply opens fewer requests; a caller asking
# for more waits here, which is the veto being exercised rather than a queue
# anybody wants.
_pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="analyze")
_slots = asyncio.Semaphore(WORKERS)


class AnalyzeRequest(BaseModel):
    url: str
    durationMs: int | None = None


class JoinPart(BaseModel):
    url: str


class JoinOverlay(BaseModel):
    """One sound mixed ON the joined parts rather than placed between them.

    Anchored to a JOIN rather than to a timestamp, because the caller knows which
    boundary it means and does not know how long the parts came out. `afterIndex`
    0 is the boundary after the first part; `offsetMs` nudges it either side, so a
    negative value pulls the sound under the tail of what came before -- which is
    the difference between a drop that lands on the last word and one that waits
    politely for it to finish.
    """

    url: str
    afterIndex: int
    # Zero is exactly on the boundary. Negative pulls it earlier.
    offsetMs: int = 0
    # What to do to the sound, and to the words underneath it, in decibels. Both
    # default to leaving things alone, so an overlay with neither named is a plain
    # sum -- which is what a short drop over speech usually wants.
    gainDb: float = 0.0
    duckDb: float = 0.0


class JoinRequest(BaseModel):
    """Several files to be made into one. See `join.py` for why the station wants it."""

    parts: list[JoinPart]
    # Absent is the ordinary join: parts one after another and nothing on top of
    # them. Every existing caller sends none, and gets exactly what it got before
    # this field existed.
    overlays: list[JoinOverlay] = []
    # 200ms by default: a beat between two turns rather than a pause. The caller
    # holds the real opinion -- this is only what a caller that said nothing gets.
    gapMs: int = 200
    # On by default, because a gap between two untrimmed parts is not a gap of
    # `gapMs`, it is `gapMs` plus two unknowns.
    trim: bool = True


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

    # A DIFFERENT fold for the vocal detector, and sharing one would be wrong
    # rather than merely tidier. `to_mono` rectifies -- it is an energy envelope,
    # not a downmix -- so a band-pass over it reads harmonics rectification
    # invented: measured, a 60 Hz bassline in real stereo arrives inside
    # 200 Hz-4 kHz at -32.5 dBFS where the waveform itself is at -96.6. The cue
    # points are calibrated against that signal and keep it; anything asking WHAT
    # is sounding rather than WHETHER needs the waveform.
    vocals = measure_vocals(to_downmix(decoded.samples), points, SAMPLE_RATE)

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
        **vocals.as_data(),
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


def _join(urls: list[str], gap_ms: int, trim: bool, overlays: list[JoinOverlay]) -> tuple[bytes, int]:
    """Fetch every part, join them, and answer with one FLAC and how long it runs.

    The parts are downloaded and probed BEFORE any of them is decoded, because
    every part has to be decoded at the same channel count -- a concatenation of
    buffers that disagree about that shears every frame after the first join.
    The count is the widest any part claims, so a mono turn beside a stereo one
    is widened rather than the stereo one folded.

    FLAC rather than wav, and it is not a preference. The host caps a plugin's
    response body at 64 MB, which a feature-length programme in 48 kHz wav
    reaches; FLAC is about half that and is lossless, so a turn is never taken
    through a lossy step on its way into the programme. It is already one of the
    formats the segment store serves.
    """
    if not urls:
        raise AnalysisError("undecodable", "there is nothing to join", status=400)
    if len(urls) > MAX_PARTS:
        raise AnalysisError("undecodable", f"more than {MAX_PARTS} parts", status=400)
    if gap_ms < 0 or gap_ms > MAX_GAP_MS:
        raise AnalysisError("undecodable", f"a gap of {gap_ms}ms is outside 0..{MAX_GAP_MS}", status=400)
    if len(overlays) > MAX_OVERLAYS:
        raise AnalysisError("undecodable", f"more than {MAX_OVERLAYS} overlays", status=400)
    for overlay in overlays:
        if abs(overlay.offsetMs) > MAX_OFFSET_MS:
            raise AnalysisError("undecodable", f"an offset of {overlay.offsetMs}ms is outside +/-{MAX_OFFSET_MS}", status=400)
        # Refused rather than clamped, unlike the app's own settings resolvers:
        # this is a request somebody composed rather than a row already stored, and
        # an overlay anchored to a boundary that does not exist is a caller's bug.
        # Silently moving it to a boundary that does would put a sound somewhere
        # nobody asked for and say nothing.
        if overlay.afterIndex < 0 or overlay.afterIndex > len(urls) - 2:
            raise AnalysisError("undecodable", f"there is no join {overlay.afterIndex} in {len(urls)} parts", status=400)

    paths: list[str] = []
    try:
        for url in urls:
            path, _ = _download(url)
            paths.append(path)

        # The overlays are fetched with the parts and decoded to the SAME channel
        # count, for the reason the parts are: summing buffers that disagree about
        # that shears every frame of the overlap.
        overlay_paths: list[str] = []
        for overlay in overlays:
            path, _ = _download(overlay.url)
            overlay_paths.append(path)
            paths.append(path)

        channels = max(_probe(path).channels for path in paths)
        parts = [_decode(path, channels).samples for path in paths[: len(urls)]]
        overlay_samples = [_decode(path, channels).samples for path in overlay_paths]
    finally:
        # Always, and all of them: a join that failed half way through has the
        # same claim on the container's disk as one that worked.
        for path in paths:
            try:
                os.unlink(path)
            except OSError:
                pass

    if trim:
        parts = [trim_to_cues(part) for part in parts]

    try:
        joined = join_samples(parts, gap_ms)

        # Placed AFTER the concatenation and against its own offsets, so the two
        # can never disagree about where a boundary is. See `join_offsets`.
        if overlays:
            boundaries = join_offsets(parts, gap_ms)
            for overlay, samples in zip(overlays, overlay_samples, strict=True):
                at = boundaries[overlay.afterIndex] + int(overlay.offsetMs * SAMPLE_RATE / 1000)
                joined = place_overlay(joined, samples, at, overlay.gainDb, overlay.duckDb)

            # Only where something was summed. An ordinary join is bit-identical to
            # one made before overlays existed.
            joined = with_headroom(joined)
    except ValueError as error:
        raise AnalysisError("undecodable", str(error), status=400) from error

    length_ms = duration_ms(joined)
    if length_ms > MAX_SECONDS * 1000:
        # Refused rather than cut. A programme over the ceiling is a mistake
        # upstream, and answering with the first half of it would air as one.
        raise AnalysisError("undecodable", f"the joined audio is longer than the {MAX_SECONDS}s limit", status=400)

    return _encode_flac(joined, channels), length_ms


def _encode_flac(samples: np.ndarray, channels: int) -> bytes:
    """Interleaved float32 back through ffmpeg as one FLAC.

    ffmpeg rather than a Python encoder for the reason everything else here
    shells out to it: it is already in the image, it is the only thing in this
    service that knows a container format, and nothing about writing a header by
    hand would be an improvement.
    """
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-f", "f32le",
        "-ar", str(SAMPLE_RATE),
        "-ac", str(channels),
        "-i", "-",
        "-f", "flac",
        "-",
    ]

    try:
        finished = subprocess.run(command, input=samples.tobytes(), capture_output=True, check=False)
    except FileNotFoundError as error:  # pragma: no cover - a broken image, not a bad request
        raise AnalysisError("internal", "ffmpeg is not installed in this image", status=500) from error

    if finished.returncode != 0:
        stderr = finished.stderr.decode("utf-8", errors="replace").strip()
        raise AnalysisError("internal", stderr[:500] or f"ffmpeg exited {finished.returncode}", status=500)

    if not finished.stdout:
        raise AnalysisError("internal", "the encoder produced no audio", status=500)

    return finished.stdout


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


def resident_mb_in(status: str) -> float | None:
    """The `VmRSS` line of a `/proc/self/status` body, in megabytes.

    Split from the file read and given a name of its own for one reason: the
    container is Linux and the machine this is developed on is not, so the only
    place this parse ever runs is the one place nobody can step through it. That
    is exactly the shape of code that ships broken, so it takes a string and
    `test_app.py` hands it one.

    `None` for a body with no such line, which is every non-Linux kernel that
    serves a `status` file at all, and for a line that does not parse. The
    kernel reports kB.
    """
    for line in status.splitlines():
        if not line.startswith("VmRSS:"):
            continue
        try:
            return round(int(line.split()[1]) / 1024, 1)
        except (ValueError, IndexError):
            return None

    return None


def _resident_mb() -> float | None:
    """This process's resident memory, or `None` where the platform will not say.

    Reported because a long-running Python process that decodes whole records
    accumulates resident memory the allocator does not return -- independent of
    any leak in the code, and a known way for an analysis worker to grow
    unbounded over long uptime. Nothing here acts on it. It is a reading, taken
    now so there is a BASELINE from before the measurements get more expensive;
    the cheap answers if it climbs are trim thresholds or recycling the worker
    every N records, and both are much easier to justify against a number.

    `/proc` rather than `resource.getrusage`, which looks like the portable
    choice and is not: `ru_maxrss` is the PEAK rather than the current figure,
    and it is kilobytes on Linux and bytes on macOS. A number that is plausible
    and means something different per platform is worse than no number, so this
    omits the field off Linux rather than guessing. The container is
    python:3.13-slim, so the service that matters always answers.
    """
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            return resident_mb_in(handle.read())
    except OSError:
        return None


@app.get("/health")
async def health() -> dict:
    # `maxConcurrent` is the CEILING and not a current reading, which is why it is
    # named for what it bounds rather than for the pool that implements it. The
    # station reports it on its connection test, so an operator who asks for more
    # than this is told here rather than finding out from a walk that got no
    # faster. See WORKERS.
    #
    # `rssMb` is the opposite kind of number -- a reading of right now, and the
    # only one here that moves between two calls. Omitted rather than faked where
    # the platform will not answer. See `_resident_mb`.
    resident = _resident_mb()

    return {
        "status": "ok",
        "schemaVersion": SCHEMA_VERSION,
        "analyzer": ANALYZER,
        "maxConcurrent": WORKERS,
        **({} if resident is None else {"rssMb": resident}),
    }


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


@app.post("/join")
async def join(request: JoinRequest) -> Response:
    """Several parts as one file. Answers AUDIO, unlike everything else here.

    Under the same semaphore and the same pool as `/analyze`, because it is the
    same work: this decodes every part it is given, and a join that escaped the
    ceiling would be a way to run the machine out of memory that the operator's
    own concurrency setting cannot see.
    """
    urls = [part.url.strip() for part in request.parts]
    if any(len(url) == 0 for url in urls):
        return _error(AnalysisError("unfetchable", "a part was given with no url", status=400))
    if any(len(overlay.url.strip()) == 0 for overlay in request.overlays):
        return _error(AnalysisError("unfetchable", "an overlay was given with no url", status=400))

    async with _slots:
        loop = asyncio.get_running_loop()
        try:
            audio, length_ms = await loop.run_in_executor(_pool, _join, urls, request.gapMs, request.trim, request.overlays)
        except AnalysisError as error:
            return _error(error)
        except Exception as error:  # noqa: BLE001 - the boundary; nothing above this catches
            return _error(AnalysisError("internal", str(error)[:500], status=500))

    # The duration rides a header rather than a second call: this service has
    # just decoded every sample, and the caller storing the row would otherwise
    # have to decode the result again to learn how long it is.
    return Response(content=audio, media_type="audio/flac", headers={"X-Duration-Ms": str(length_ms)})


def _error(error: AnalysisError) -> JSONResponse:
    return JSONResponse({"error": {"code": error.code, "message": error.message}}, status_code=error.status)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
