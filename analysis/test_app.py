"""The plumbing in `app.py` that can be exercised without HTTP or a decoder.

Almost everything in that file is a subprocess, a socket or a thread pool, and is
covered end to end by the station rather than here. What is left is the handful
of pure parses -- and one of them runs ONLY in the container, on a kernel the
machine this is written on does not have, which is the case worth a test more
than any of the others.

    python3 -m pytest analysis/test_app.py
"""

from __future__ import annotations

import numpy as np
import pytest

import app
from app import AnalysisError, Decoded, Probed, _analyze, _join, _trim, resident_mb_in

# Trimmed from a real `/proc/self/status`, keeping the neighbours that make the
# parse non-trivial: `VmRSS` is not the first line, and three other keys start
# with the same four characters.
STATUS = """Name:\tpython3
State:\tS (sleeping)
VmPeak:\t  982416 kB
VmSize:\t  914880 kB
VmHWM:\t  187364 kB
VmRSS:\t  121244 kB
RssAnon:\t   93820 kB
Threads:\t6
"""


def test_reads_the_resident_line_and_not_a_neighbour():
    # 121244 kB, and the neighbours above and below it are both larger figures
    # that a looser match would take instead.
    assert resident_mb_in(STATUS) == 118.4


def test_says_nothing_for_a_body_without_the_line():
    # Every kernel that serves a `status` file in another shape. Absent is the
    # answer, and `/health` then omits the field rather than reporting a zero
    # that reads as a process using no memory.
    assert resident_mb_in("Name:\tpython3\nState:\tS (sleeping)\n") is None


def test_says_nothing_for_an_empty_body():
    assert resident_mb_in("") is None


def test_says_nothing_for_a_line_it_cannot_parse():
    # Belt and braces: the format is stable and this is what keeps a surprise in
    # it from throwing inside a health check, which is the one endpoint that has
    # to answer when everything else is broken.
    assert resident_mb_in("VmRSS:\tplenty\n") is None
    assert resident_mb_in("VmRSS:\n") is None


def test_trim_does_not_raise_off_glibc():
    # This machine is macOS: there is no `libc.so.6`, so the module-level
    # resolution in `app.py` already failed to find the symbol and fell back to
    # a no-op. The value of the guard is exactly this -- the import above did
    # not crash, and calling the no-op does not either.
    _trim()


def _spy_trim(monkeypatch: pytest.MonkeyPatch) -> list[None]:
    """Replace `app._trim` with one that records every call, in place."""
    calls: list[None] = []
    monkeypatch.setattr(app, "_trim", lambda: calls.append(None))
    return calls


def _stub_decode(monkeypatch: pytest.MonkeyPatch, *, channels: int = 1) -> None:
    """A one-frame silent decode, standing in for ffmpeg."""
    silence = Decoded(samples=np.zeros((app.SAMPLE_RATE, channels), dtype=np.float32), duration_ms=1000)
    monkeypatch.setattr(app, "_decode", lambda path, channels: silence)


def test_analyze_trims_after_a_successful_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _spy_trim(monkeypatch)
    monkeypatch.setattr(app, "_download", lambda url: ("/no/such/file", True))
    monkeypatch.setattr(app, "_probe", lambda path: Probed(channels=1, tags={}))
    _stub_decode(monkeypatch)

    result = _analyze("https://example.invalid/track.flac", None)

    # Exactly once: this is the ONE decode this call made, not once per worker
    # or once per request regardless of what happened.
    assert len(calls) == 1
    assert result["complete"] is True


def test_analyze_trims_even_when_the_decode_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # The whole point of putting it in `finally`: a track that fails to decode
    # still freed whatever ffmpeg and the download buffer allocated, and the
    # next request should not inherit that.
    calls = _spy_trim(monkeypatch)
    monkeypatch.setattr(app, "_download", lambda url: ("/no/such/file", True))
    monkeypatch.setattr(app, "_probe", lambda path: Probed(channels=1, tags={}))
    monkeypatch.setattr(app, "_decode", lambda path, channels: (_ for _ in ()).throw(AnalysisError("undecodable", "boom")))

    with pytest.raises(AnalysisError):
        _analyze("https://example.invalid/track.flac", None)

    assert len(calls) == 1


def test_join_trims_once_after_decoding_every_part(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _spy_trim(monkeypatch)
    paths = iter(["/no/such/a", "/no/such/b"])
    monkeypatch.setattr(app, "_download", lambda url: (next(paths), True))
    monkeypatch.setattr(app, "_probe", lambda path: Probed(channels=1, tags={}))
    _stub_decode(monkeypatch)

    audio, length_ms = _join(["https://example.invalid/a.flac", "https://example.invalid/b.flac"], 0, False, [])

    # One trim for the whole join, not one per part -- the pool of downloads is
    # freed together in the same `finally`, after the last part is decoded.
    assert len(calls) == 1
    assert length_ms > 0
    assert audio


def test_join_trims_even_when_a_later_part_fails_to_decode(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _spy_trim(monkeypatch)
    paths = iter(["/no/such/a", "/no/such/b"])
    monkeypatch.setattr(app, "_download", lambda url: (next(paths), True))
    monkeypatch.setattr(app, "_probe", lambda path: Probed(channels=1, tags={}))

    decode_calls = {"n": 0}

    def failing_decode(path: str, channels: int) -> Decoded:
        decode_calls["n"] += 1
        if decode_calls["n"] == 2:
            raise AnalysisError("undecodable", "boom")
        return Decoded(samples=np.zeros((app.SAMPLE_RATE, channels), dtype=np.float32), duration_ms=1000)

    monkeypatch.setattr(app, "_decode", failing_decode)

    with pytest.raises(AnalysisError):
        _join(["https://example.invalid/a.flac", "https://example.invalid/b.flac"], 0, False, [])

    assert len(calls) == 1
