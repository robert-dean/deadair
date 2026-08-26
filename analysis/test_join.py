"""Joining, against synthetic parts.

Synthetic for `test_measure.py`'s reason: what is worth pinning is the SHAPE of
the answer -- the parts land in order, the gap is between them and not at the
ends, a trim takes the engine's padding off and never takes the whole part.

    python3 -m pytest analysis/test_join.py
"""

from __future__ import annotations

import numpy as np
import pytest

from join import MAX_GAP_MS, MAX_PARTS, duration_ms, join_samples, trim_to_cues
from measure import SAMPLE_RATE


def tone(seconds: float, freq: float = 440.0, amplitude: float = 0.5, channels: int = 1) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE), dtype=np.float32) / SAMPLE_RATE
    signal = (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.tile(signal[:, None], (1, channels))


def silence(seconds: float, channels: int = 1) -> np.ndarray:
    return np.zeros((int(seconds * SAMPLE_RATE), channels), dtype=np.float32)


def test_the_parts_are_joined_in_order_with_the_gap_between_them():
    joined = join_samples([tone(1.0), tone(1.0)], gap_ms=200)

    assert duration_ms(joined) == pytest.approx(2200, abs=2)


def test_the_gap_goes_between_and_never_at_the_ends():
    joined = join_samples([tone(0.5), tone(0.5)], gap_ms=500)

    # Silence exactly where the join is, and audio at both ends: padding the
    # head or tail would put back the dead air the trim exists to remove.
    middle = joined[int(0.6 * SAMPLE_RATE) : int(0.9 * SAMPLE_RATE)]
    assert np.max(np.abs(middle)) == 0.0
    assert np.max(np.abs(joined[: int(0.1 * SAMPLE_RATE)])) > 0.1
    assert np.max(np.abs(joined[-int(0.1 * SAMPLE_RATE) :])) > 0.1


def test_no_gap_is_a_straight_concatenation():
    joined = join_samples([tone(1.0), tone(1.0)], gap_ms=0)

    assert joined.shape[0] == 2 * int(SAMPLE_RATE)


def test_one_part_is_itself():
    part = tone(1.0)
    joined = join_samples([part], gap_ms=400)

    assert joined.shape == part.shape


def test_stereo_parts_keep_their_channels():
    joined = join_samples([tone(0.5, channels=2), tone(0.5, channels=2)], gap_ms=100)

    assert joined.shape[1] == 2


def test_parts_that_disagree_about_channels_are_refused_rather_than_folded():
    with pytest.raises(ValueError):
        join_samples([tone(0.5, channels=1), tone(0.5, channels=2)], gap_ms=0)


def test_nothing_to_join_is_refused():
    with pytest.raises(ValueError):
        join_samples([], gap_ms=0)


def test_too_many_parts_is_refused():
    with pytest.raises(ValueError):
        join_samples([tone(0.01) for _ in range(MAX_PARTS + 1)], gap_ms=0)


def test_a_gap_outside_the_band_is_refused():
    with pytest.raises(ValueError):
        join_samples([tone(0.5), tone(0.5)], gap_ms=MAX_GAP_MS + 1)
    with pytest.raises(ValueError):
        join_samples([tone(0.5), tone(0.5)], gap_ms=-1)


def test_a_trim_takes_the_padding_off_both_ends():
    part = np.concatenate([silence(1.0), tone(2.0), silence(1.5)])
    trimmed = trim_to_cues(part)

    assert 1900 <= duration_ms(trimmed) <= 2150


def test_a_trim_leaves_a_part_that_is_already_tight_alone():
    part = tone(2.0)
    trimmed = trim_to_cues(part)

    assert duration_ms(trimmed) == pytest.approx(2000, abs=30)


def test_a_silent_part_is_kept_rather_than_trimmed_to_nothing():
    # A beat of room tone is a beat somebody wrote. A zero-length turn is a
    # worse answer than a quiet one.
    part = silence(1.0)
    trimmed = trim_to_cues(part)

    assert trimmed.shape[0] == part.shape[0]


def test_an_empty_part_is_left_as_it_is():
    part = np.zeros((0, 1), dtype=np.float32)

    assert trim_to_cues(part).shape[0] == 0


def test_trimming_before_joining_is_what_makes_the_gap_the_gap():
    parts = [np.concatenate([silence(0.5), tone(1.0), silence(0.5)]) for _ in range(2)]
    joined = join_samples([trim_to_cues(part) for part in parts], gap_ms=200)

    # Two seconds of speech and one 200ms beat, rather than that plus two
    # unknown stretches of engine padding.
    assert 2150 <= duration_ms(joined) <= 2400
