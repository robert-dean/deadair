"""Loudness and true peak, against values the standard fixes.

Unlike the cue points, some of this has right answers rather than only sensible
ones. EBU Tech 3341 specifies compliance signals with stated loudness, and the
first two tests are those: a 1 kHz sine at -23 LUFS and one at -33 LUFS, both
within the ±0.1 LU the standard allows.

That is worth having because every part of the chain can be subtly wrong in a
way that still produces plausible numbers -- the wrong filter stage order, a
missing offset, the gate applied to the wrong quantity -- and all of them show
up here as a fraction of a decibel.

    python3 -m pytest analysis/test_loudness.py
"""

from __future__ import annotations

import numpy as np
import pytest

from loudness import REFERENCE_RATE, integrated_lufs, sample_peak_db, true_peak_db

# EBU Tech 3341 states its compliance tolerance as ±0.1 LU.
TOLERANCE_LU = 0.1


# The standard's calibration frequency, and it is 997 Hz rather than 1000 for a
# reason worth knowing: the K-weighting curve's gain at 997 Hz is +0.691 dB,
# which cancels the -0.691 offset in the loudness equation EXACTLY. So at this
# one frequency, loudness in LUFS is simply RMS in dBFS, and nothing about the
# filter or the offset can hide in the arithmetic.
#
# At 1000 Hz the curve is already +0.698 dB, so a test written there reads 0.7 LU
# high and looks like a broken implementation. It is not: it is the wrong test
# frequency, which is the trap this constant exists to avoid.
CALIBRATION_HZ = 997.0


def sine(seconds: float, freq: float = CALIBRATION_HZ, amplitude: float = 1.0) -> np.ndarray:
    t = np.arange(int(seconds * REFERENCE_RATE), dtype=np.float64) / REFERENCE_RATE
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def at_lufs(target: float, seconds: float = 20.0) -> np.ndarray:
    """A sine at CALIBRATION_HZ scaled so its measured loudness should be `target`.

    Because the weighting cancels the offset at this frequency, the derivation is
    just "what amplitude gives this RMS": the RMS of a sine is its amplitude over
    root two, i.e. 3.01 dB below peak.
    """
    amplitude = 10.0 ** ((target + 3.0103) / 20.0)
    return sine(seconds, CALIBRATION_HZ, amplitude)


class TestAgainstTheStandard:
    def test_a_minus_23_lufs_sine_measures_minus_23(self):
        assert integrated_lufs(at_lufs(-23.0)) == pytest.approx(-23.0, abs=TOLERANCE_LU)

    def test_a_minus_33_lufs_sine_measures_minus_33(self):
        assert integrated_lufs(at_lufs(-33.0)) == pytest.approx(-33.0, abs=TOLERANCE_LU)

    def test_the_calibration_frequency_reads_its_own_rms(self):
        """At 997 Hz the weighting cancels the offset, so LUFS == dBFS RMS.

        A sine of amplitude 0.1 has an RMS of -23.01 dBFS, and reads -23 LUFS.
        The round number is not a coincidence; it is the calibration.
        """
        assert integrated_lufs(sine(20.0, CALIBRATION_HZ, 0.1)) == pytest.approx(-23.01, abs=TOLERANCE_LU)

    def test_halving_the_amplitude_costs_six_lu(self):
        loud = integrated_lufs(at_lufs(-23.0))
        quiet = integrated_lufs(at_lufs(-29.02))
        assert loud is not None and quiet is not None
        assert loud - quiet == pytest.approx(6.02, abs=0.05)

    def test_the_weighting_curve_is_applied_at_all(self):
        """Same amplitude, different frequencies, and the curve's own shape.

        This is most of what makes the figure loudness rather than RMS: without
        the two filter stages all three of these would be equal. The expected
        gaps are the published curve's, so a stage applied in the wrong order or
        dropped entirely shows up here rather than passing as "roughly right".
        """
        reference = integrated_lufs(sine(20.0, CALIBRATION_HZ, 0.5))
        low = integrated_lufs(sine(20.0, 100.0, 0.5))
        high = integrated_lufs(sine(20.0, 10_000.0, 0.5))

        assert reference is not None and low is not None and high is not None
        # The curve reads -1.133 dB at 100 Hz and +4.042 at 10 kHz, against +0.691 here.
        assert low - reference == pytest.approx(-1.133 - 0.691, abs=0.15)
        assert high - reference == pytest.approx(4.042 - 0.691, abs=0.15)


class TestGating:
    def test_silence_before_and_after_does_not_drag_the_figure_down(self):
        """The whole point of the gate: this is a record with a long quiet lead-out."""
        tone = at_lufs(-23.0, seconds=20.0)
        silence = np.zeros(int(20.0 * REFERENCE_RATE), dtype=np.float32)
        padded = np.concatenate([silence, tone, silence])

        assert integrated_lufs(padded) == pytest.approx(-23.0, abs=TOLERANCE_LU)

    def test_a_quiet_passage_is_gated_out_of_a_loud_record(self):
        """A verse 15 LU below the body of the track must not pull the figure down."""
        loud = at_lufs(-20.0, seconds=20.0)
        quiet = at_lufs(-35.0, seconds=20.0)

        measured = integrated_lufs(np.concatenate([loud, quiet, loud]))
        assert measured is not None
        # Ungated this would land near -23; the relative gate keeps it at the body's level.
        assert measured == pytest.approx(-20.0, abs=0.5)

    def test_total_silence_has_no_loudness_rather_than_a_very_low_one(self):
        # None, not -80: a caller computing a gain from -80 would boost by 70 dB.
        assert integrated_lufs(np.zeros(REFERENCE_RATE * 5, dtype=np.float32)) is None

    def test_something_shorter_than_one_gating_block_is_not_guessed_at(self):
        assert integrated_lufs(sine(0.2)) is None

    def test_empty_input_does_not_raise(self):
        assert integrated_lufs(np.zeros(0, dtype=np.float32)) is None


class TestTruePeak:
    def test_a_full_scale_sine_peaks_near_zero_dbfs(self):
        peak = true_peak_db(sine(1.0, 997.0, 1.0))
        assert peak is not None
        assert peak == pytest.approx(0.0, abs=0.2)

    def test_true_peak_finds_what_sample_peak_misses(self):
        """THE reason this is oversampled rather than read off the samples.

        A sine whose frequency divides awkwardly into the sample rate never lands
        on its own crest, so every sample understates it. Applying a gain
        computed against the sample peak is how a quiet master gets lifted into
        clipping.
        """
        # Deliberately close to Nyquist/4, where the gap is largest.
        awkward = sine(1.0, 11_999.0, 0.999)

        sample = sample_peak_db(awkward)
        true = true_peak_db(awkward)

        assert sample is not None and true is not None
        assert true > sample, "oversampling found no inter-sample peak at all"

    def test_it_reports_a_peak_above_full_scale_rather_than_clamping(self):
        """An inter-sample peak over 0 dBFS is real and is the thing worth knowing."""
        loud = sine(1.0, 11_999.0, 1.0)
        peak = true_peak_db(loud)

        assert peak is not None
        assert peak > 0.0

    def test_a_long_track_is_chunked_without_missing_the_peak(self):
        """The peak must survive the chunk boundary it sits on."""
        quiet = sine(6.0, 997.0, 0.1)
        spike_at = int(2.5 * REFERENCE_RATE)
        quiet[spike_at : spike_at + 64] = sine(1.0, 11_999.0, 0.95)[:64]

        peak = true_peak_db(quiet)
        assert peak is not None
        assert peak > -1.0

    def test_silence_has_no_peak(self):
        assert true_peak_db(np.zeros(REFERENCE_RATE, dtype=np.float32)) is None
        assert sample_peak_db(np.zeros(REFERENCE_RATE, dtype=np.float32)) is None
