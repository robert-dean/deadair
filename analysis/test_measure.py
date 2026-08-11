"""Cue points against synthetic records.

Synthetic rather than real audio, because what is worth pinning is the SHAPE of
the answer -- silence trimmed, an intro that needs sustain, an ending that is
found where it begins rather than where it stops. Whether the numbers are right
on a real record is a question only listening answers, and README.md says so.

The case that matters most is `test_quiet_ending_is_not_called_early`. That is
the failure the band limit exists to prevent, and it is the one a full-band
envelope gets wrong.

    python3 -m pytest analysis/test_measure.py
"""

from __future__ import annotations

import numpy as np

from measure import SAMPLE_RATE, measure

RNG = np.random.default_rng(1234)


def tone(seconds: float, freq: float = 440.0, amplitude: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE), dtype=np.float32) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def bass(seconds: float, amplitude: float = 0.5) -> np.ndarray:
    """Below the analysis band, so it must NOT register as the record being present."""
    return tone(seconds, freq=60.0, amplitude=amplitude)


def test_silence_is_trimmed_from_both_ends():
    signal = np.concatenate([silence(1.0), tone(3.0), silence(2.0)])
    points = measure(signal)

    assert 950 <= points.cue_in <= 1050
    assert 3950 <= points.cue_out <= 4100


def test_points_are_ordered_and_inside_the_file():
    signal = np.concatenate([silence(0.5), tone(4.0), silence(0.5)])
    points = measure(signal)

    assert points.cue_in <= points.intro_end <= points.outro_start <= points.cue_out
    assert points.cue_out <= int(len(signal) * 1000 / SAMPLE_RATE)


def test_all_silence_reports_an_empty_sounding_region_rather_than_guessing():
    points = measure(silence(3.0))

    assert points.cue_in == 0
    assert points.cue_out == 3000
    # Nothing sounded, so there is no intro and the "ending" is the whole file.
    assert points.intro_end == 0


def test_empty_input_does_not_raise():
    points = measure(np.zeros(0, dtype=np.float32))
    assert points.cue_in == 0 and points.cue_out == 0


def test_a_transient_over_an_ambient_opening_is_not_the_record_starting():
    """One click at 0.5s, the record proper at 2s. intro_end must be the latter."""
    quiet = tone(2.0, amplitude=0.02)
    quiet[int(0.5 * SAMPLE_RATE) : int(0.5 * SAMPLE_RATE) + 200] = 0.9
    signal = np.concatenate([quiet, tone(4.0, amplitude=0.6)])

    points = measure(signal)

    assert points.intro_end > 1500, f"a transient was mistaken for the intro ending at {points.intro_end}ms"


def test_quiet_ending_is_not_called_early():
    """THE case the band limit exists for.

    A record whose bass drops out for the last four seconds while a quiet
    mid-range figure carries on. A full-band or low-weighted envelope calls the
    outro at the moment the bass leaves; the record is plainly still going.
    """
    body = (tone(6.0, freq=880.0, amplitude=0.6) + bass(6.0, amplitude=0.8)).astype(np.float32)
    # No bass, and quieter, but still well within the band and well above silence.
    tail = tone(4.0, freq=880.0, amplitude=0.42)
    signal = np.concatenate([body, tail])

    points = measure(signal)

    where_bass_left = 6000
    assert points.outro_start > where_bass_left + 500, (
        f"outro_start landed at {points.outro_start}ms, at or before the bass leaving at "
        f"{where_bass_left}ms -- the envelope is being dragged by low frequencies"
    )


def test_a_cold_ending_has_a_short_outro():
    """Full level right up to the cut: the ending begins near the end."""
    signal = np.concatenate([tone(8.0, amplitude=0.6), silence(0.5)])
    points = measure(signal)

    outro = points.cue_out - points.outro_start
    assert outro < 700, f"a cold ending produced a {outro}ms outro"


def test_a_fade_has_a_longer_outro_than_a_cold_ending():
    """The comparison is the point: a blend is sized from it, not from a constant."""
    cold = np.concatenate([tone(8.0, amplitude=0.6), silence(0.5)])

    body = tone(5.0, amplitude=0.6)
    ramp = tone(3.0, amplitude=0.6) * np.linspace(1.0, 0.02, int(3.0 * SAMPLE_RATE), dtype=np.float32)
    faded = np.concatenate([body, ramp.astype(np.float32), silence(0.5)])

    cold_points, fade_points = measure(cold), measure(faded)
    cold_outro = cold_points.cue_out - cold_points.outro_start
    fade_outro = fade_points.cue_out - fade_points.outro_start

    assert fade_outro > cold_outro * 2, f"fade outro {fade_outro}ms was not meaningfully longer than cold {cold_outro}ms"


def test_noise_does_not_break_the_ordering():
    """Realistic-ish input: the invariants have to hold on something unruly."""
    noise = (RNG.standard_normal(int(6.0 * SAMPLE_RATE)) * 0.25).astype(np.float32)
    signal = np.concatenate([silence(0.3), noise, silence(0.3)])

    points = measure(signal)
    assert points.cue_in <= points.intro_end <= points.outro_start <= points.cue_out
