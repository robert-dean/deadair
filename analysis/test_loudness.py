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

from loudness import REFERENCE_RATE, integrated_lufs, k_weight, sample_peak_db, to_mono, true_peak_db

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


class TestChannels:
    """The measurement must see the real channels, not a downmix.

    This is the easiest thing in the file to get wrong, because a downmix
    produces a number that looks entirely plausible. It shipped wrong once. The
    figures below were taken from ffmpeg's own `ebur128` on the same signals.
    """

    def stereo(self, left: np.ndarray, right: np.ndarray) -> np.ndarray:
        return np.stack([left, right], axis=1)

    def test_two_identical_channels_are_three_lu_louder_than_one(self):
        """BS.1770 sums channel power; it does not average it.

        Two correlated channels really are louder than one, and a measurement
        that says otherwise is averaging somewhere.
        """
        one = sine(20.0, CALIBRATION_HZ, 0.1)

        mono = integrated_lufs(one)
        both = integrated_lufs(self.stereo(one, one))

        assert mono is not None and both is not None
        assert both - mono == pytest.approx(3.01, abs=0.05)

    def test_uncorrelated_channels_are_not_read_three_db_low(self):
        """The failure that shipped: uncorrelated noise measured -18.8 against a true -15.8."""
        rng = np.random.default_rng(7)
        length = int(20.0 * REFERENCE_RATE)
        left = (0.08 * rng.standard_normal(length)).astype(np.float32)
        right = (0.08 * rng.standard_normal(length)).astype(np.float32)

        measured = integrated_lufs(self.stereo(left, right))
        assert measured is not None
        # ffmpeg's ebur128 reports -15.8 LUFS for this signal.
        assert measured == pytest.approx(-15.8, abs=0.3)

    def test_anti_phase_material_still_has_a_loudness(self):
        """The other failure: a downmix cancels it to nothing and reports no reading at all."""
        one = sine(20.0, CALIBRATION_HZ, 0.1)

        measured = integrated_lufs(self.stereo(one, -one))
        assert measured is not None, "anti-phase channels cancelled, so this is measuring a downmix"
        # ffmpeg reports -20.0: the same as two correlated channels, since power sums either way.
        assert measured == pytest.approx(-20.0, abs=0.2)

    def test_a_peak_in_one_channel_alone_is_still_the_peak(self):
        quiet = sine(2.0, CALIBRATION_HZ, 0.01)
        loud = sine(2.0, CALIBRATION_HZ, 0.9)

        peak = true_peak_db(self.stereo(quiet, loud))
        assert peak is not None
        assert peak == pytest.approx(-0.9, abs=0.3)


class TestToMono:
    """The fold used for the cue points, which is a different question again."""

    def test_it_keeps_anti_phase_content_instead_of_cancelling_it(self):
        # A plain (L+R)/2 would produce silence here, and the cue points would
        # then report a record that never sounds.
        one = sine(2.0, CALIBRATION_HZ, 0.5)
        folded = to_mono(np.stack([one, -one], axis=1))

        assert float(np.max(np.abs(folded))) > 0.4

    def test_mono_passes_through_unchanged(self):
        one = sine(1.0, CALIBRATION_HZ, 0.3)
        assert np.allclose(to_mono(one), one)


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


_BLOCK = int(REFERENCE_RATE * 400 / 1000)
_STEP = int(REFERENCE_RATE * 100 / 1000)
_OFFSET_DB = -0.691


def _reference_mean_square(weighted: np.ndarray, block: int, step: int, count: int) -> np.ndarray:
    """The OLD strided block-mean, kept so the cumsum path is checked against the
    thing it replaced rather than against itself."""
    blocks = np.lib.stride_tricks.as_strided(
        weighted,
        shape=(count, block),
        strides=(weighted.strides[0] * step, weighted.strides[0]),
        writeable=False,
    )
    return np.mean(np.square(blocks), axis=1)


def _cumsum_mean_square(weighted: np.ndarray, block: int, step: int, count: int) -> np.ndarray:
    """The NEW running-sum form, copied inline rather than imported so the test
    still catches a regression to the strided form inside `integrated_lufs`."""
    squared = weighted.copy()
    np.square(squared, out=squared)
    csum = np.empty(squared.size + 1, dtype=np.float64)
    csum[0] = 0.0
    np.cumsum(squared, out=csum[1:])
    starts = np.arange(count) * step
    return (csum[starts + block] - csum[starts]) / block


class TestCumsumMatchesTheStridedReference:
    """`integrated_lufs` now sums with a running total instead of a strided
    block-mean. Pairwise (cumsum) and sequential summation are not
    bit-identical, so this compares to a tolerance rather than by equality."""

    @pytest.mark.parametrize(
        "n",
        [
            _BLOCK,
            _BLOCK + _STEP - 1,
            _BLOCK + _STEP * 5 + 1,  # (n - block) % step != 0
        ],
    )
    def test_cumsum_matches_the_strided_reference(self, n: int):
        rng = np.random.default_rng(n)
        weighted = rng.standard_normal(n)
        count = 1 + (n - _BLOCK) // _STEP

        expected = _reference_mean_square(weighted, _BLOCK, _STEP, count)
        actual = _cumsum_mean_square(weighted, _BLOCK, _STEP, count)

        assert actual == pytest.approx(expected, abs=1e-9)

        expected_lufs = _OFFSET_DB + 10.0 * np.log10(np.mean(expected))
        actual_lufs = _OFFSET_DB + 10.0 * np.log10(np.mean(actual))
        assert actual_lufs == pytest.approx(expected_lufs, abs=1e-6)

    def test_cumsum_matches_the_strided_reference_20s_stereo(self):
        """The same comparison, but over real stereo input and through the
        public `integrated_lufs`, summing each channel's mean square the way
        the function itself does."""
        length = int(20.0 * REFERENCE_RATE)
        rng = np.random.default_rng(20)
        left = (0.2 * rng.standard_normal(length)).astype(np.float32)
        right = (0.2 * rng.standard_normal(length)).astype(np.float32)
        stereo = np.stack([left, right], axis=1)

        count = 1 + (length - _BLOCK) // _STEP
        expected_mean_square = np.zeros(count, dtype=np.float64)
        actual_mean_square = np.zeros(count, dtype=np.float64)
        for channel in (left, right):
            weighted = k_weight(channel.astype(np.float64), REFERENCE_RATE)
            expected_mean_square += _reference_mean_square(weighted.copy(), _BLOCK, _STEP, count)
            actual_mean_square += _cumsum_mean_square(weighted.copy(), _BLOCK, _STEP, count)

        assert actual_mean_square == pytest.approx(expected_mean_square, abs=1e-9)

        expected_lufs = _OFFSET_DB + 10.0 * np.log10(np.mean(expected_mean_square))
        measured_lufs = integrated_lufs(stereo)
        assert measured_lufs is not None
        assert measured_lufs == pytest.approx(expected_lufs, abs=1e-6)


class TestAllocatesOnlyWhatIsNeeded:
    """`integrated_lufs`, `to_mono` and `true_peak_db` used to eagerly copy a
    whole column (or the whole track) to a contiguous float64 buffer before
    doing anything with it. They now cast only the slice actually being
    worked on -- a running block, a chunk, a scratch row -- so these check
    that the answer does not depend on the caller handing over a contiguous
    array, since that assumption is exactly what a lazier cast could break.
    """

    def test_to_mono_folds_three_channels_by_energy(self):
        """The per-channel scratch-buffer loop must still sum power across
        every channel, not just the two the earlier stereo-only tests exercised."""
        one = sine(2.0, CALIBRATION_HZ, 0.3)
        two = sine(2.0, CALIBRATION_HZ, 0.4)
        three = sine(2.0, CALIBRATION_HZ, 0.5)

        folded = to_mono(np.stack([one, two, three], axis=1))

        expected = np.sqrt((one.astype(np.float64) ** 2 + two.astype(np.float64) ** 2 + three.astype(np.float64) ** 2) / 3).astype(
            np.float32
        )
        assert np.allclose(folded, expected, atol=1e-6)

    def test_to_mono_handles_empty_multichannel_input(self):
        empty_stereo = np.zeros((0, 2), dtype=np.float32)
        folded = to_mono(empty_stereo)
        assert folded.shape == (0,)

    def test_true_peak_matches_on_a_non_contiguous_channel_view(self):
        """The chunk cast now happens on whatever slice `column` is, instead of
        on a pre-copied contiguous column. Feed it a channel that is a strided
        view (taken from the middle of a larger interleaved buffer) and check
        it still finds the same peak as the equivalent plain array."""
        awkward = sine(3.0, 11_999.0, 0.95)
        interleaved = np.stack([awkward, np.zeros_like(awkward)], axis=1)
        # channels[:, 0] below is a strided, non-contiguous view.
        view_peak = true_peak_db(interleaved[:, :1])
        plain_peak = true_peak_db(np.ascontiguousarray(awkward))

        assert view_peak is not None and plain_peak is not None
        assert view_peak == pytest.approx(plain_peak, abs=1e-6)

    def test_integrated_lufs_matches_on_a_non_contiguous_channel_view(self):
        """Same concern as above, for the cumsum block-loudness path: a channel
        sliced out of an interleaved array must measure the same as one handed
        over as its own plain array."""
        tone = at_lufs(-23.0, seconds=20.0)
        interleaved = np.stack([tone, np.zeros_like(tone)], axis=1)

        via_view = integrated_lufs(interleaved[:, :1])
        via_plain = integrated_lufs(np.ascontiguousarray(tone))

        assert via_view is not None and via_plain is not None
        assert via_view == pytest.approx(via_plain, abs=1e-9)


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
