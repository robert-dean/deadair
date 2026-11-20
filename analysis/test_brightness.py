"""Brightness on synthetic signals whose ORDER is known.

These pin the arithmetic: a darker signal reads lower, gain changes nothing, silence and a sting have
no figure. They say nothing about whether brightness tracks how energetic a record FEELS, because a
synthetic signal is easier than any record (the vocal detector passed against a held tone and carried
no vocal information on real music). That question is `energy.check.py`'s, on real records.

    python3 -m pytest analysis/test_brightness.py
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy import signal as dsp

from brightness import FRAME, HOP, MIN_SOUNDING_SECONDS, RATE, brightness_hz

SECONDS = 30.0


def tone(hz: float, seconds: float = SECONDS, level: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (level * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def noise(seconds: float = SECONDS, level: float = 0.1, seed: int = 7) -> np.ndarray:
    return (level * np.random.default_rng(seed).standard_normal(int(seconds * RATE))).astype(np.float32)


def low_passed(x: np.ndarray, hz: float) -> np.ndarray:
    sos = dsp.butter(4, hz, btype="low", fs=RATE, output="sos")
    return dsp.sosfilt(sos, x).astype(np.float32)


def test_a_tone_reads_its_own_frequency() -> None:
    found = brightness_hz(tone(440.0))

    assert found is not None
    assert abs(found - 440.0) < 5.0


def test_a_lower_tone_is_darker() -> None:
    assert brightness_hz(tone(200.0)) < brightness_hz(tone(2000.0))


def test_white_noise_sits_near_the_middle_of_the_spectrum() -> None:
    found = brightness_hz(noise())

    assert found is not None
    assert abs(found - RATE / 4) < 300.0


def test_low_passed_noise_is_darker_than_the_noise_it_came_from() -> None:
    white = noise()

    assert brightness_hz(low_passed(white, 1000.0)) < brightness_hz(white)


def test_turning_a_record_up_or_down_does_not_move_it() -> None:
    record = low_passed(noise(level=0.2), 3000.0) + tone(110.0, level=0.2)
    base = brightness_hz(record)

    assert base is not None
    assert brightness_hz(record * 0.25) == pytest.approx(base, abs=0.5)
    assert brightness_hz(record * 2.0) == pytest.approx(base, abs=0.5)


def test_silence_has_no_figure() -> None:
    assert brightness_hz(np.zeros(int(SECONDS * RATE), dtype=np.float32)) is None


def test_a_signal_below_the_floor_is_silence() -> None:
    # -80 dBFS: the hiss under a fade, not the record.
    assert brightness_hz(noise(level=1e-4)) is None


def test_a_sting_is_too_short_to_judge() -> None:
    assert brightness_hz(tone(440.0, seconds=MIN_SOUNDING_SECONDS / 2)) is None


def test_silence_around_a_record_does_not_count_toward_it_or_colour_it() -> None:
    gap = np.zeros(int(60 * RATE), dtype=np.float32)
    middle = tone(440.0, seconds=MIN_SOUNDING_SECONDS / 2)

    # Ten sounding seconds inside two minutes of silence is still a sting.
    assert brightness_hz(np.concatenate([gap, middle, gap])) is None
    # And a long silent tail leaves a record's figure where it was.
    record = tone(440.0)
    assert brightness_hz(np.concatenate([record, gap])) == pytest.approx(brightness_hz(record), abs=0.5)


def test_a_hiss_under_a_long_fade_does_not_drag_it_toward_the_noise() -> None:
    record = tone(300.0)
    hiss = noise(seconds=60.0, level=1e-4)

    assert brightness_hz(np.concatenate([record, hiss])) == pytest.approx(brightness_hz(record), abs=0.5)


def test_one_cymbal_crash_does_not_move_the_median() -> None:
    record = tone(300.0)
    crash = noise(seconds=0.5, level=0.5)
    with_crash = record.copy()
    with_crash[RATE * 10 : RATE * 10 + len(crash)] += crash

    assert brightness_hz(with_crash) == pytest.approx(brightness_hz(record), abs=5.0)


def test_the_same_signal_reads_the_same_every_time() -> None:
    record = low_passed(noise(), 2000.0)

    assert brightness_hz(record) == brightness_hz(record.copy())


def test_a_record_longer_than_one_pass_reads_as_one_record() -> None:
    # Ten minutes is several of the passes the spectrum is taken in; the passes must not show.
    long = np.tile(tone(500.0, seconds=60.0), 10)

    found = brightness_hz(long)

    assert found is not None
    assert abs(found - 500.0) < 5.0


def test_a_signal_shorter_than_one_frame_has_no_figure() -> None:
    assert brightness_hz(tone(440.0, seconds=(FRAME - 1) / RATE)) is None


def test_it_refuses_the_wrong_rate_and_a_signal_with_channels() -> None:
    with pytest.raises(ValueError):
        brightness_hz(tone(440.0), rate=48000)
    with pytest.raises(ValueError):
        brightness_hz(np.stack([tone(440.0), tone(440.0)], axis=1))


def test_the_frame_and_hop_overlap_by_half() -> None:
    # The centroid's resolution and its cost are both set by these; a change to either is a change to
    # every stored figure, which is a schema question rather than a tidy-up.
    assert (FRAME, HOP, RATE) == (1024, 512, 22050)
