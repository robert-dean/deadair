"""Measures the beat tracker on real records, before anything in the station runs it. See analysis/README.md.

Every number a consumer will lean on is chosen from this, not from a synthetic signal: a held tone is
the negative control that let the vocal detector ship while carrying no vocal information at all.

  python3 beats.check.py CHECKPOINT[,CHECKPOINT] FILE...          one row per record and checkpoint
  python3 beats.check.py --listen CHECKPOINT FILE OUT.wav          the record with clicks on it, to hear

Each row has the wall and CPU seconds the model took, this process's resident memory afterwards, the
tempo, the confidence and each part of it. A click on a downbeat is high and one on any other beat is low.

Runs in the sidecar's own image, since that is where the pins are:

  docker run --rm --cpus=2 -v "$PWD/analysis:/check:ro" -v /records:/records:ro -v /weights:/weights:ro \\
      --entrypoint sh IMAGE -c 'cd /check && PYTHONDONTWRITEBYTECODE=1 python3 beats.check.py /weights/small0.ckpt /records/*'
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import wave

import numpy as np

from beat_model import track
from beats import beats_from
from loudness import REFERENCE_RATE, to_mono
from measure import measure

CLICK_SECONDS = 0.03
DOWNBEAT_HZ = 1760.0
BEAT_HZ = 880.0
CLICK_LEVEL = 0.5


def decode(path: str) -> np.ndarray:
    """The same decode the sidecar does: float32 at the reference rate, keeping the channels."""
    finished = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "2", "-ar", str(REFERENCE_RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    flat = np.frombuffer(finished.stdout, dtype=np.float32)
    return flat[: flat.size // 2 * 2].reshape(-1, 2)


def resident_mb() -> float:
    with open("/proc/self/status", encoding="ascii") as status:
        for line in status:
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024.0
    return float("nan")


def report(checkpoints: list[str], paths: list[str]) -> None:
    print("checkpoint\twall_s\tcpu_s\trss_mb\tminutes\tbpm\tconfidence\tstrength\tregularity\tcoverage\toctave\tdownbeats\trecord", flush=True)
    for path in paths:
        samples = decode(path)
        points = measure(to_mono(samples), REFERENCE_RATE)
        for checkpoint in checkpoints:
            wall, cpu = time.perf_counter(), time.process_time()
            beat_seconds, downbeat_seconds, logits = track(samples, checkpoint)
            wall, cpu = time.perf_counter() - wall, time.process_time() - cpu
            found = beats_from(beat_seconds, downbeat_seconds, logits, points.cue_out - points.cue_in)
            head = f"{os.path.basename(checkpoint)}\t{wall:.1f}\t{cpu:.1f}\t{resident_mb():.0f}\t{samples.shape[0] / REFERENCE_RATE / 60:.1f}"
            if found is None:
                print(f"{head}\t-\t-\t-\t-\t-\t-\t{downbeat_seconds.size}\t{os.path.basename(path)}", flush=True)
                continue
            print(
                f"{head}\t{found.bpm:.1f}\t{found.confidence:.3f}\t{found.strength:.3f}\t{found.regularity:.3f}"
                f"\t{found.coverage:.3f}\t{found.octave:.3f}\t{len(found.downbeats_ms)}\t{os.path.basename(path)}",
                flush=True,
            )


def clicks(frames: int, seconds: np.ndarray, hz: float) -> np.ndarray:
    out = np.zeros(frames, dtype=np.float32)
    length = int(CLICK_SECONDS * REFERENCE_RATE)
    time_axis = np.arange(length) / REFERENCE_RATE
    click = (CLICK_LEVEL * np.sin(2 * np.pi * hz * time_axis) * np.linspace(1.0, 0.0, length)).astype(np.float32)
    for second in seconds:
        start = int(second * REFERENCE_RATE)
        stop = min(start + length, frames)
        if start < frames:
            out[start:stop] += click[: stop - start]
    return out


def listen(checkpoint: str, path: str, destination: str) -> None:
    samples = decode(path)
    beat_seconds, downbeat_seconds, _ = track(samples, checkpoint)
    ordinary = np.setdiff1d(np.rint(beat_seconds * 50), np.rint(downbeat_seconds * 50)) / 50
    mix = samples.mean(axis=1) * 0.5 + clicks(samples.shape[0], ordinary, BEAT_HZ) + clicks(samples.shape[0], downbeat_seconds, DOWNBEAT_HZ)
    pcm = (np.clip(mix, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(destination, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(REFERENCE_RATE)
        out.writeframes(pcm.tobytes())


def main(arguments: list[str]) -> None:
    if arguments[:1] == ["--listen"] and len(arguments) == 4:
        listen(arguments[1], arguments[2], arguments[3])
    elif len(arguments) >= 2:
        report(arguments[0].split(","), arguments[1:])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
