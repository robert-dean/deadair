"""The small copy `/transcode` makes, without ffmpeg.

The CI runner has no ffmpeg, so the encoder is stubbed as `test_app.py` stubs
the FLAC one. What is worth pinning is what this service promises around the
encode: which encoder it asks for, that it leaves nothing on disk whichever way
the call goes, and that a short download is refused rather than sent.

    python3 -m pytest analysis/test_transcode.py
"""

from __future__ import annotations

import os
import tempfile

import pytest

import app
from app import AnalysisError, _transcode, aac_command


def _download_to_a_real_file(monkeypatch: pytest.MonkeyPatch, *, whole: bool = True) -> str:
    """A download that leaves a real temp file, so the test can see it unlinked."""
    handle = tempfile.NamedTemporaryFile(suffix=".audio", delete=False)
    handle.write(b"RIFF....WAVE")
    handle.close()
    monkeypatch.setattr(app, "_download", lambda url: (handle.name, whole))
    return handle.name


def _spy_encode(monkeypatch: pytest.MonkeyPatch, *, fail: bool = False) -> list[str]:
    """An encoder that writes a few bytes where ffmpeg would, and records where."""
    outs: list[str] = []

    def encode(source: str, out: str, bitrate_kbps: int, channels: int) -> None:
        outs.append(out)
        if fail:
            raise AnalysisError("undecodable", "boom")
        with open(out, "wb") as handle:
            handle.write(b"....ftypM4A ")

    monkeypatch.setattr(app, "_encode_aac", encode)
    monkeypatch.setattr(app, "_duration_of", lambda path: 31_250)
    return outs


def test_the_command_asks_for_the_native_encoder_and_never_fdk() -> None:
    command = aac_command("/in.wav", "/out.m4a", 64, 1)

    assert command[command.index("-c:a") + 1] == "aac"
    assert not any("fdk" in part for part in command)
    assert command[command.index("-b:a") + 1] == "64k"
    assert command[command.index("-ac") + 1] == "1"
    # A file, not a pipe: the index an MP4 writes last needs a seekable output.
    assert command[-1] == "/out.m4a"
    assert "+faststart" in command


def test_a_copy_comes_back_with_its_length(monkeypatch: pytest.MonkeyPatch) -> None:
    _download_to_a_real_file(monkeypatch)
    _spy_encode(monkeypatch)

    audio, length_ms = _transcode("https://example.invalid/a.wav", 64, 1)

    assert audio == b"....ftypM4A "
    assert length_ms == 31_250


def test_nothing_is_left_on_disk_after_a_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    download = _download_to_a_real_file(monkeypatch)
    outs = _spy_encode(monkeypatch)

    _transcode("https://example.invalid/a.wav", 64, 1)

    assert not os.path.exists(download)
    assert not os.path.exists(os.path.dirname(outs[0]))


def test_nothing_is_left_on_disk_when_the_encode_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    download = _download_to_a_real_file(monkeypatch)
    outs = _spy_encode(monkeypatch, fail=True)

    with pytest.raises(AnalysisError):
        _transcode("https://example.invalid/a.wav", 64, 1)

    assert not os.path.exists(download)
    assert not os.path.exists(os.path.dirname(outs[0]))


def test_a_short_download_is_refused_rather_than_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    download = _download_to_a_real_file(monkeypatch, whole=False)
    outs = _spy_encode(monkeypatch)

    with pytest.raises(AnalysisError) as raised:
        _transcode("https://example.invalid/a.wav", 64, 1)

    assert raised.value.code == "unfetchable"
    assert outs == []
    assert not os.path.exists(download)
