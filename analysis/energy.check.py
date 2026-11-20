"""Measures a record's two energy parts on real records, ranked against each other. See analysis/README.md.

The station's energy is a record's loudness and its brightness, each ranked against the library and
averaged. This does the same over the records it is given, so the composition can be judged by ear on
real music before anything leans on it. A synthetic signal cannot judge it: the vocal detector passed
against a held tone and carried no vocal information on any real record.

  python3 energy.check.py FILE...                     one row per record, calmest first
  python3 energy.check.py --felt SCORES.tsv FILE...   and how far each part agrees with an ear

Each row has the seconds the decode and each pass took, the integrated loudness, the brightness, the
percentile rank of each among the records given, and their mean, which is the energy. Sorted by it, so
the calmest and the most energetic records are at either end to listen to.

`--felt` reads `NAME<TAB>SCORE` lines, NAME being a file's base name and SCORE any number (1 to 5
is enough), written down BEFORE looking at the figures, and prints Spearman's rank correlation of each
part and of the energy against them.

Runs in the sidecar's own image, since that is where the pins are:

  docker run --rm --cpus=2 -v "$PWD/analysis:/check:ro" -v /records:/records:ro \\
      --entrypoint sh IMAGE -c 'cd /check && PYTHONDONTWRITEBYTECODE=1 python3 energy.check.py /records/*'
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

import numpy as np

from beat_model import model_signal
from brightness import brightness_hz
from loudness import REFERENCE_RATE, integrated_lufs


def decode(path: str) -> np.ndarray:
    """The same decode the sidecar does: float32 at the reference rate, keeping the channels."""
    finished = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "2", "-ar", str(REFERENCE_RATE), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    flat = np.frombuffer(finished.stdout, dtype=np.float32)
    return flat[: flat.size // 2 * 2].reshape(-1, 2)


def percentile_ranks(values: np.ndarray) -> np.ndarray:
    """Each value's rank among the others, 0 to 100, ties sharing their mean rank."""
    order = np.argsort(values, kind="stable")
    ranks = np.empty(len(values), dtype=np.float64)
    ranks[order] = np.arange(len(values), dtype=np.float64)
    for value in np.unique(values):
        tied = values == value
        ranks[tied] = ranks[tied].mean()
    return 100.0 * ranks / max(1, len(values) - 1)


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.corrcoef(percentile_ranks(a), percentile_ranks(b))[0, 1])


def measure_all(paths: list[str]) -> list[dict]:
    rows = []
    for path in paths:
        started = time.perf_counter()
        samples = decode(path)
        decoded = time.perf_counter()
        lufs = integrated_lufs(samples, REFERENCE_RATE)
        loud = time.perf_counter()
        signal = model_signal(samples)
        del samples
        bright = brightness_hz(signal)
        done = time.perf_counter()
        rows.append(
            {
                "name": os.path.basename(path),
                "minutes": signal.size / 22050 / 60,
                "decode_s": decoded - started,
                "loudness_s": loud - decoded,
                "brightness_s": done - loud,
                "lufs": lufs,
                "hz": bright,
            }
        )
        print(f"measured {rows[-1]['name']}", file=sys.stderr, flush=True)
    return rows


def report(rows: list[dict], felt: dict[str, float]) -> None:
    usable = [row for row in rows if row["lufs"] is not None and row["hz"] is not None]
    for row in rows:
        if row not in usable:
            print(f"no figure for {row['name']} (silent, or under 20 s sounding)", file=sys.stderr)
    if not usable:
        return

    lufs = np.array([row["lufs"] for row in usable])
    hz = np.array([row["hz"] for row in usable])
    loud_rank, bright_rank = percentile_ranks(lufs), percentile_ranks(hz)
    energy = (loud_rank + bright_rank) / 2

    print("energy\tloud_rank\tbright_rank\tlufs\tbrightness_hz\tminutes\tdecode_s\tloudness_s\tbrightness_s\trecord")
    for index in np.argsort(energy, kind="stable"):
        row = usable[index]
        print(
            f"{energy[index]:.0f}\t{loud_rank[index]:.0f}\t{bright_rank[index]:.0f}\t{row['lufs']:.1f}\t{row['hz']:.0f}"
            f"\t{row['minutes']:.1f}\t{row['decode_s']:.2f}\t{row['loudness_s']:.2f}\t{row['brightness_s']:.2f}\t{row['name']}"
        )

    scored = [index for index, row in enumerate(usable) if row["name"] in felt]
    if len(scored) >= 3:
        ear = np.array([felt[usable[index]["name"]] for index in scored])
        print(f"\nagreement with {len(scored)} felt scores (Spearman):")
        print(f"  loudness   {spearman(lufs[scored], ear):+.2f}")
        print(f"  brightness {spearman(hz[scored], ear):+.2f}")
        print(f"  energy     {spearman(energy[scored], ear):+.2f}")


def read_felt(path: str) -> dict[str, float]:
    felt = {}
    with open(path, encoding="utf-8") as lines:
        for line in lines:
            name, _, score = line.rstrip("\n").partition("\t")
            if name and score:
                felt[name] = float(score)
    return felt


def main(arguments: list[str]) -> None:
    felt: dict[str, float] = {}
    if arguments[:1] == ["--felt"] and len(arguments) >= 3:
        felt, arguments = read_felt(arguments[1]), arguments[2:]
    if not arguments:
        sys.exit(__doc__)
    report(measure_all(arguments), felt)


if __name__ == "__main__":
    main(sys.argv[1:])
