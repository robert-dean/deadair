"""The arithmetic from a tracker's answer to a tempo and a confidence, on synthetic logits.

This pins the SHAPE of the answer and nothing about its numbers: whether the confidence separates a
steady record from a rubato one is a question for real records, and `beats.check.py` asks it.

    python3 -m pytest analysis/test_beats.py
"""

from __future__ import annotations

import numpy as np

from beats import FPS, beats_from

MINUTE_MS = 60_000


def logits_with_peaks(seconds: np.ndarray, length_s: float = 60.0, level: float = 6.0, others: dict[float, float] | None = None) -> np.ndarray:
    """Quiet everywhere, with a peak at each time."""
    logits = np.full(int(length_s * FPS), -8.0)
    logits[np.rint(seconds * FPS).astype(int)] = level
    for second, value in (others or {}).items():
        logits[int(round(second * FPS))] = value
    return logits


def steady(bpm: float, length_s: float = 60.0) -> np.ndarray:
    return np.arange(0.0, length_s - 0.5, 60.0 / bpm)


def test_a_steady_record_is_read_as_its_tempo_and_trusted() -> None:
    beats = steady(120.0)
    found = beats_from(beats, beats[::4], logits_with_peaks(beats), MINUTE_MS)

    assert found is not None
    assert abs(found.bpm - 120.0) < 0.5
    assert found.confidence > 0.9


def test_the_tempo_gets_under_the_models_frames() -> None:
    # 117 BPM falls between two frame steps, so the median of frame-placed beats reads 115.4 or 119.
    beats = np.rint(steady(117.0) * FPS) / FPS
    found = beats_from(beats, beats[::4], logits_with_peaks(beats), MINUTE_MS)

    assert found is not None
    assert abs(found.bpm - 117.0) < 0.2


def test_a_fill_does_not_drag_the_tempo() -> None:
    beats = steady(120.0)
    with_a_gap = np.concatenate([beats[:50], beats[60:]])
    found = beats_from(with_a_gap, with_a_gap[::4], logits_with_peaks(with_a_gap), MINUTE_MS)

    assert found is not None
    assert abs(found.bpm - 120.0) < 0.2


def test_the_wire_shape_is_the_three_fields_in_integer_milliseconds() -> None:
    beats = steady(120.0)
    found = beats_from(beats, beats[::4], logits_with_peaks(beats), MINUTE_MS)

    assert found is not None
    data = found.as_data()
    assert set(data) == {"bpm", "beatConfidence", "downbeats"}
    assert data["downbeats"][:2] == [0, 2000]
    assert all(isinstance(value, int) for value in data["downbeats"])


def test_too_few_beats_is_no_answer_rather_than_a_low_confidence() -> None:
    beats = steady(120.0)[:5]
    assert beats_from(beats, beats[:1], logits_with_peaks(beats), MINUTE_MS) is None


def test_a_tempo_out_of_range_is_no_answer() -> None:
    beats = steady(300.0)
    assert beats_from(beats, beats[::4], logits_with_peaks(beats), MINUTE_MS) is None


def test_silence_has_no_tempo() -> None:
    beats = steady(120.0)
    assert beats_from(beats, beats[::4], logits_with_peaks(beats), 0) is None


def test_weak_peaks_are_trusted_less() -> None:
    beats = steady(120.0)
    strong = beats_from(beats, beats[::4], logits_with_peaks(beats, level=6.0), MINUTE_MS)
    weak = beats_from(beats, beats[::4], logits_with_peaks(beats, level=0.5), MINUTE_MS)

    assert strong is not None and weak is not None
    assert weak.confidence < strong.confidence * 0.8


def test_an_unsteady_pulse_is_trusted_less() -> None:
    generator = np.random.default_rng(7)
    wandering = np.cumsum(0.5 * generator.uniform(0.6, 1.4, 110))
    wandering = wandering[wandering < 59.0]
    found = beats_from(wandering, wandering[::4], logits_with_peaks(wandering), MINUTE_MS)

    assert found is not None
    assert found.regularity < 0.5
    assert found.confidence < 0.5


def test_a_pulse_through_only_part_of_the_record_is_trusted_less() -> None:
    beats = steady(120.0, 15.0)
    found = beats_from(beats, beats[::4], logits_with_peaks(beats), MINUTE_MS)

    assert found is not None
    assert found.coverage < 0.3


def test_as_much_activation_between_the_beats_says_this_may_be_half_the_tempo() -> None:
    beats = steady(70.0)
    between = {float(second): 6.0 for second in (beats[:-1] + beats[1:]) / 2.0}
    found = beats_from(beats, beats[::4], logits_with_peaks(beats, others=between), MINUTE_MS)

    assert found is not None
    assert found.octave < 0.1
    assert found.confidence < 0.1


def test_every_other_beat_being_much_weaker_says_this_may_be_double_the_tempo() -> None:
    beats = steady(140.0)
    weak = {float(second): -4.0 for second in beats[1::2]}
    found = beats_from(beats, beats[::4], logits_with_peaks(beats, others=weak), MINUTE_MS)

    assert found is not None
    assert found.octave < 0.1


def test_a_frame_nothing_predicted_does_not_overflow() -> None:
    beats = steady(120.0)
    logits = logits_with_peaks(beats)
    logits[:10] = -1000.0

    assert beats_from(beats, beats[::4], logits, MINUTE_MS) is not None
