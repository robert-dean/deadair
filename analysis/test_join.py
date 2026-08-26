"""Joining, against synthetic parts.

Synthetic for `test_measure.py`'s reason: what is worth pinning is the SHAPE of
the answer -- the parts land in order, the gap is between them and not at the
ends, a trim takes the engine's padding off and never takes the whole part.

    python3 -m pytest analysis/test_join.py
"""

from __future__ import annotations

import numpy as np
import pytest

from join import MAX_GAP_MS, MAX_PARTS, duration_ms, join_offsets, join_samples, place_overlay, trim_to_cues, with_headroom
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


def test_join_offsets_agree_with_where_the_concatenation_actually_puts_a_boundary():
    # The one thing these two must never disagree about. An overlay anchored to a
    # boundary the concatenation put somewhere else lands in the middle of a word.
    parts = [tone(1.0), tone(0.5), tone(0.25)]

    joined = join_samples(parts, 200)
    offsets = join_offsets(parts, 200)

    assert len(offsets) == 2
    # Each offset is where its part ENDS, so the gap that follows starts there and
    # the frames it covers are silent.
    for at in offsets:
        gap = joined[at : at + int(200 * SAMPLE_RATE / 1000)]
        assert float(np.max(np.abs(gap))) == 0.0


def test_a_single_part_has_no_boundaries_to_anchor_to():
    assert join_offsets([tone(1.0)], 200) == []


def test_an_overlay_lands_where_it_was_put_and_moves_nothing():
    base = np.zeros((SAMPLE_RATE, 1), dtype=np.float32)
    overlay = np.ones((100, 1), dtype=np.float32) * 0.5

    mixed = place_overlay(base, overlay, at_frame=500)

    # Nothing moved: the buffer is exactly as long as it was, which is the whole
    # difference between mixing a drop in and splicing one in.
    assert mixed.shape == base.shape
    assert float(np.max(np.abs(mixed[500:600]))) == pytest.approx(0.5)
    assert float(np.max(np.abs(mixed[:500]))) == 0.0
    assert float(np.max(np.abs(mixed[600:]))) == 0.0


def test_a_negative_offset_pulls_a_sound_under_the_tail_of_what_came_before():
    # The point of the whole feature: a drop that lands ON the last word rather
    # than after it.
    words = np.ones((SAMPLE_RATE, 1), dtype=np.float32) * 0.2
    drop = np.ones((1000, 1), dtype=np.float32) * 0.3

    at = SAMPLE_RATE - 500
    mixed = place_overlay(words, drop, at_frame=at)

    # The overlap carries both, and the part before it carries only the words.
    assert float(np.max(np.abs(mixed[at:]))) == pytest.approx(0.5)
    assert float(np.max(np.abs(mixed[: at - 1]))) == pytest.approx(0.2)


def test_an_overlay_that_starts_before_the_buffer_is_clipped_rather_than_raising():
    # A caller nudging an overlay around a boundary should not have to know how
    # long the parts were.
    base = np.zeros((100, 1), dtype=np.float32)
    overlay = np.ones((400, 1), dtype=np.float32) * 0.5

    mixed = place_overlay(base, overlay, at_frame=-300)

    assert mixed.shape == base.shape
    # 300 frames of it fell before the start, so the last 100 of it land.
    assert float(np.max(np.abs(mixed))) == pytest.approx(0.5)


def test_an_overlay_entirely_past_the_end_changes_nothing():
    base = np.ones((100, 1), dtype=np.float32) * 0.2
    overlay = np.ones((50, 1), dtype=np.float32)

    mixed = place_overlay(base, overlay, at_frame=500)

    assert float(np.max(np.abs(mixed))) == pytest.approx(0.2)


def test_ducking_pulls_the_words_down_for_the_span_and_only_the_span():
    words = np.ones((1000, 1), dtype=np.float32) * 0.4
    drop = np.zeros((100, 1), dtype=np.float32)

    mixed = place_overlay(words, drop, at_frame=400, duck_db=-6.0)

    # Inside the span the words are attenuated; outside it they are untouched,
    # which is what makes a sound audible over speech without turning the speech
    # down for the whole break.
    assert float(np.max(np.abs(mixed[400:500]))) == pytest.approx(0.4 * 10 ** (-6 / 20), rel=1e-4)
    assert float(np.max(np.abs(mixed[:400]))) == pytest.approx(0.4)
    assert float(np.max(np.abs(mixed[500:]))) == pytest.approx(0.4)


def test_the_duck_does_not_pull_the_overlay_down_with_it():
    words = np.ones((1000, 1), dtype=np.float32) * 0.4
    drop = np.ones((100, 1), dtype=np.float32) * 0.5

    mixed = place_overlay(words, drop, at_frame=400, duck_db=-6.0)

    # The duck is applied BEFORE the sum. Applied after, the sound the duck exists
    # to make room for would be attenuated by exactly the room it made.
    assert float(np.max(np.abs(mixed[400:500]))) == pytest.approx(0.4 * 10 ** (-6 / 20) + 0.5, rel=1e-4)


def test_gain_scales_the_overlay_alone():
    base = np.zeros((1000, 1), dtype=np.float32)
    drop = np.ones((100, 1), dtype=np.float32) * 0.5

    mixed = place_overlay(base, drop, at_frame=0, gain_db=-6.0)

    assert float(np.max(np.abs(mixed[:100]))) == pytest.approx(0.5 * 10 ** (-6 / 20), rel=1e-4)


def test_a_full_scale_sound_over_full_scale_words_does_not_clip():
    # Summing is where clipping starts, and it is the one thing overlays introduce
    # that concatenation never could.
    words = np.ones((1000, 1), dtype=np.float32) * 0.9
    drop = np.ones((100, 1), dtype=np.float32) * 0.9

    mixed = with_headroom(place_overlay(words, drop, at_frame=0))

    assert float(np.max(np.abs(mixed))) <= 1.0


def test_headroom_preserves_the_ratio_the_caller_asked_for():
    # A LINEAR scale rather than a limiter: only the ratio between the words and
    # the sound survives, and the ratio is the part the caller actually asked for.
    # The station measures what it made and stamps a gain from that, so the
    # absolute level does not matter.
    words = np.ones((1000, 1), dtype=np.float32) * 0.9
    drop = np.ones((100, 1), dtype=np.float32) * 0.9

    mixed = with_headroom(place_overlay(words, drop, at_frame=0))

    loud = float(np.max(np.abs(mixed[:100])))
    quiet = float(np.max(np.abs(mixed[100:])))
    assert loud / quiet == pytest.approx(1.8 / 0.9, rel=1e-4)


def test_headroom_leaves_an_ordinary_join_bit_identical():
    joined = join_samples([tone(0.5), tone(0.5)], 200)

    assert np.array_equal(with_headroom(joined), joined)
