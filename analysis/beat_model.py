"""The beat tracker itself: `beat_this`, reached without its `inference.py`.

`inference.py` imports `soxr` at its top, and soxr is LGPL, which `analysis/README.md` refuses. So
that module is never imported, and this file holds the two things it would have provided: reading a
checkpoint, and running a model trained on 30 second excerpts over a whole record. `split_piece` and
`aggregate` below are adapted from it (MIT, (c) 2024 Institute of Computational Perception, JKU Linz)
and pinned to `beat_this==1.1.0` by `requirements.nodeps.txt`, since this reaches past its public
entry points.

Torch is imported on first use, so `import app` and the CI job that has no torch both still work.

**One inference at a time, and a capped thread count**, whatever `analysis.concurrency` says. The
mixer shares this machine in the single-container image, and one model is one set of weights however
many records are waiting, so a second inference would only take cores from what is on air.
"""

from __future__ import annotations

import inspect
import os
import threading

import numpy as np
from scipy import signal as dsp

from loudness import REFERENCE_RATE

MODEL_RATE = 22050

# What the model was trained on, in frames, and what its edges cannot be trusted for. Both are
# `Spect2Frames`' own figures.
CHUNK_FRAMES = 1500
BORDER_FRAMES = 6

THREADS = max(1, int(os.environ.get("ANALYSIS_BEAT_THREADS", "2")))

# Both images put the weights here at build, checked against a pinned hash. A path and never a name,
# because a name is what makes `beat_this` go looking on the network.
CHECKPOINT = os.environ.get("ANALYSIS_BEAT_CHECKPOINT", "/srv/beat_this-final0.ckpt")

_lock = threading.Lock()
_loaded: dict[str, "_Tracker"] = {}


class _Tracker:
    def __init__(self, checkpoint_path: str) -> None:
        import torch
        from beat_this.model.beat_tracker import BeatThis
        from beat_this.model.postprocessor import Postprocessor
        from beat_this.preprocessing import LogMelSpect
        from beat_this.utils import replace_state_dict_key

        torch.set_num_threads(THREADS)
        self.torch = torch

        # `weights_only`, because a checkpoint is a pickle and this one is downloaded.
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        accepted = set(inspect.signature(BeatThis).parameters)
        model = BeatThis(**{key: value for key, value in checkpoint["hyper_parameters"].items() if key in accepted})
        model.load_state_dict(replace_state_dict_key(checkpoint["state_dict"], "model.", ""))

        self.model = model.eval()
        self.spect = LogMelSpect(device="cpu")
        self.postprocess = Postprocessor(type="minimal", fps=50)

    def __call__(self, mono: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        torch = self.torch
        with torch.inference_mode():
            spect = self.spect(torch.tensor(mono, dtype=torch.float32))
            chunks, starts = split_piece(spect)
            beat, downbeat = aggregate([self.model(chunk.unsqueeze(0)) for chunk in chunks], starts, spect.shape[0])
            beat_seconds, downbeat_seconds = self.postprocess(beat, downbeat)
        return np.asarray(beat_seconds, dtype=np.float64), np.asarray(downbeat_seconds, dtype=np.float64), beat.numpy()


def split_piece(spect):
    """Overlapping excerpts of the model's length, the first and last padded out to it."""
    import torch.nn.functional as F

    usable = CHUNK_FRAMES - 2 * BORDER_FRAMES
    length = spect.shape[0]
    starts = np.arange(-BORDER_FRAMES, length - BORDER_FRAMES, usable)
    if length > usable:
        # The last excerpt ends at the record's end rather than running short.
        starts[-1] = length - (CHUNK_FRAMES - BORDER_FRAMES)

    chunks = []
    for start in starts:
        start = int(start)
        piece = spect[max(start, 0) : min(start + CHUNK_FRAMES, length)]
        left = max(0, -start)
        right = max(0, min(BORDER_FRAMES, start + CHUNK_FRAMES - length))
        chunks.append(F.pad(piece, (0, 0, left, right), "constant", 0) if left or right else piece)
    return chunks, starts


def aggregate(predictions, starts, length: int):
    """The excerpts' answers as one record's, earlier excerpts winning where they overlap."""
    import torch

    beat = torch.full((length,), -1000.0)
    downbeat = torch.full((length,), -1000.0)
    for start, prediction in reversed(list(zip(starts, predictions))):
        first = int(start) + BORDER_FRAMES
        last = int(start) + CHUNK_FRAMES - BORDER_FRAMES
        beat[first:last] = prediction["beat"][0][BORDER_FRAMES:-BORDER_FRAMES]
        downbeat[first:last] = prediction["downbeat"][0][BORDER_FRAMES:-BORDER_FRAMES]
    return beat.float(), downbeat.float()


def model_signal(samples: np.ndarray, sample_rate: int = REFERENCE_RATE) -> np.ndarray:
    """The channels as one signal at the model's rate.

    An average, and NOT `loudness.to_mono`, which rectifies and is documented as unusable for anything
    spectral: it lifted a 60 Hz bassline into the mid band by 64 dB. `resample_poly` is what replaces
    soxr, which is the only thing `beat_this` wanted it for.
    """
    mono = samples.mean(axis=1) if samples.ndim == 2 else samples
    if sample_rate == MODEL_RATE:
        return mono.astype(np.float32)
    divisor = np.gcd(MODEL_RATE, sample_rate)
    return dsp.resample_poly(mono, MODEL_RATE // divisor, sample_rate // divisor).astype(np.float32)


def _tracker(checkpoint_path: str) -> _Tracker:
    # Under `_lock`, or two workers arriving together would each load a copy.
    tracker = _loaded.get(checkpoint_path)
    if tracker is None:
        tracker = _loaded[checkpoint_path] = _Tracker(checkpoint_path)
    return tracker


def load(checkpoint_path: str = CHECKPOINT) -> None:
    """Read the checkpoint now. Both images call this at build, since nothing else proves it loads."""
    with _lock:
        _tracker(checkpoint_path)


def track_signal(mono: np.ndarray, checkpoint_path: str = CHECKPOINT) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Beat times and downbeat times in seconds, and the framewise beat logits, for {@link model_signal}'s answer."""
    with _lock:
        return _tracker(checkpoint_path)(mono)


def track(samples: np.ndarray, checkpoint_path: str = CHECKPOINT, sample_rate: int = REFERENCE_RATE) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """{@link track_signal} from the decoded channels, for a caller with no reason to let them go first."""
    return track_signal(model_signal(samples, sample_rate), checkpoint_path)
