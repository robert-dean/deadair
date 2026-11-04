"""From a beat tracker's framewise answer to a tempo, how far to trust it, and the bar lines.

Pure measurement, and numpy alone, so it runs against synthetic logits without torch. The model is
`beat_model.py`, and that split is what lets the CI job test this without installing a gigabyte.

`beat_this` returns beat times and logits, and no tempo and no confidence. Both are worked out here.
The confidence is the field that matters: the ladder in discussion 45 exists to refuse a blend on weak
evidence, and a figure that says "definitely 140" about a 70 BPM record is worse than no figure, so
it has to mark itself down when half or double the tempo is about as plausible.

Each part of it is kept and reported, because `beats.check.py` chooses how they combine on real
records rather than on the synthetic ones here. A held tone is the negative control that let the
vocal detector ship, so nothing in these constants is settled by this file's tests.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Frames a second in the model's output: `LogMelSpect`'s hop of 441 samples at 22050 Hz.
FPS = 50

# What the model is trained to find. Outside this, a median interval is a gap or a roll, not a pulse.
MIN_BPM = 40.0
MAX_BPM = 220.0

# Fewer beats than this is no evidence of a pulse at all, whatever they look like.
MIN_BEATS = 8

# How far an interval may sit from the median and still be the same pulse. Eight percent is about
# what a human drummer drifts within a bar, and a record that changes tempo fails it honestly.
REGULAR_WITHIN = 0.08

# An interval longer than this many medians is a stretch with no pulse rather than a slow beat.
GAP_MEDIANS = 1.75


@dataclass(frozen=True)
class Beats:
    """A record's tempo as measured, with the evidence for it."""

    bpm: float
    confidence: float
    downbeats_ms: list[int]

    # The parts of `confidence`, each 0 to 1.
    strength: float
    regularity: float
    coverage: float
    octave: float

    def as_data(self) -> dict[str, object]:
        """The wire shape. camelCase because it is stored and read as JSON."""
        return {
            "bpm": round(self.bpm, 2),
            "beatConfidence": round(self.confidence, 3),
            "downbeats": self.downbeats_ms,
        }


def _probabilities(logits: np.ndarray) -> np.ndarray:
    # Aggregated frames with no prediction hold -1000, so this has to survive a very large exponent.
    return 1.0 / (1.0 + np.exp(np.clip(-logits, -50.0, 50.0)))


def _at(probabilities: np.ndarray, seconds: np.ndarray) -> np.ndarray:
    """The largest probability within a frame of each time, since a peak can land between frames."""
    frames = np.clip(np.rint(seconds * FPS).astype(int), 0, probabilities.size - 1)
    lower = np.maximum(frames - 1, 0)
    upper = np.minimum(frames + 1, probabilities.size - 1)
    return np.maximum.reduce([probabilities[lower], probabilities[frames], probabilities[upper]])


def _octave(probabilities: np.ndarray, beats: np.ndarray) -> float:
    """How clearly this tempo beats its neighbours an octave away. 1 is clear, 0 is a coin toss.

    Two questions, and the worse answer stands. Is there nearly as much activation BETWEEN the beats,
    which says double time? And is every other beat much weaker than the rest, which says half time?
    """
    on = _at(probabilities, beats)
    between = _at(probabilities, (beats[:-1] + beats[1:]) / 2.0)
    double_time = float(np.mean(between) / max(float(np.mean(on)), 1e-6))

    odd = float(np.mean(on[0::2]))
    even = float(np.mean(on[1::2]))
    half_time = 1.0 - min(odd, even) / max(odd, even, 1e-6)

    return float(np.clip(1.0 - max(double_time, half_time), 0.0, 1.0))


def beats_from(
    beat_seconds: np.ndarray,
    downbeat_seconds: np.ndarray,
    beat_logits: np.ndarray,
    sounding_ms: int,
) -> Beats | None:
    """The figures for one record, or `None` where there is no pulse to report.

    `None` rather than a low confidence for a record with hardly any beats or a tempo out of range,
    because the field's absence is what every consumer already degrades over. `sounding_ms` is the
    length between the cue points, so a long silence at either end is not counted against a record.
    """
    if beat_seconds.size < MIN_BEATS or sounding_ms <= 0:
        return None

    intervals = np.diff(beat_seconds)
    median = float(np.median(intervals))
    if median <= 0:
        return None

    # The MEAN of the intervals that belong to the pulse. A median alone is one interval, which the
    # model's 20 ms frames can only place on steps: measured on real records it read 125, 130.4 and
    # 136.4 and nothing between, about 2% wrong on Billie Jean, against a 4% gate for matching two
    # records. Averaging over hundreds of beats gets under the frame, and leaving out what is not the
    # pulse keeps a fill or a gap from dragging it.
    regular = np.abs(intervals - median) <= median * REGULAR_WITHIN
    bpm = 60.0 / float(np.mean(intervals[regular]))
    if not MIN_BPM <= bpm <= MAX_BPM:
        return None

    probabilities = _probabilities(beat_logits)

    strength = float(np.mean(_at(probabilities, beat_seconds)))
    regularity = float(np.mean(regular))
    pulsed_ms = float(np.sum(intervals[intervals <= median * GAP_MEDIANS])) * 1000.0
    coverage = float(np.clip(pulsed_ms / sounding_ms, 0.0, 1.0))
    octave = _octave(probabilities, beat_seconds)

    return Beats(
        bpm=bpm,
        confidence=strength * regularity * coverage * octave,
        downbeats_ms=[int(round(float(second) * 1000.0)) for second in downbeat_seconds],
        strength=strength,
        regularity=regularity,
        coverage=coverage,
        octave=octave,
    )
