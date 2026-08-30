"""Programme loudness and true peak, to ITU-R BS.1770-4 / EBU R128.

Separate from `measure.py` because it answers a different question about the
same samples. The cue points say WHERE things happen; this says how loud the
record is overall, which is what a per-track gain is computed from.

Why it belongs in the same pass rather than in its own service: the expensive
part of measuring anything here is the download and the decode, and both are
already paid for by the time these functions are called. Loudness on top is a
few filter passes over an array that is already in memory.

## What the numbers are for

`integratedLufs` is the loudness the whole record sits at, gated so that quiet
passages and silence do not drag it down. A static per-track gain is the
difference between it and the station's target, which is a better answer than a
live normalizer alone: a normalizer is a follower, so it pumps on dynamic
material, takes a moment on each new item, and fights the duck ramp because both
are moving gain at once.

`truePeakDb` is what stops that gain from clipping. It is deliberately NOT the
sample peak: reconstructing the analogue waveform between samples can overshoot
the highest sample by a decibel or more, and a lossy codec routinely produces
inter-sample peaks above 0 dBFS. Applying a boost computed against sample peak
alone is how a quiet master gets lifted into distortion.
"""

from __future__ import annotations

import numpy as np
from scipy import signal

# BS.1770 specifies its filters as digital coefficients at 48 kHz, and every
# other rate requires re-deriving them from the analogue prototype. That
# re-derivation is the step most likely to be quietly wrong, so the decode
# happens at the reference rate instead and the coefficients below are the
# published ones, used as published.
REFERENCE_RATE = 48000

# Stage 1: the shelving filter approximating the head's acoustic effect.
_SHELF_B = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
_SHELF_A = np.array([1.0, -1.69065929318241, 0.73248077421585])

# Stage 2: the RLB weighting curve, a high-pass.
_RLB_B = np.array([1.0, -2.0, 1.0])
_RLB_A = np.array([1.0, -1.99004745483398, 0.99007225036621])

# The offset in the loudness equation. Not a fudge factor: it is what aligns the
# K-weighted mean square with the LKFS scale.
_OFFSET_DB = -0.691

BLOCK_MS = 400
# 75% overlap, as specified. The overlap is not decoration -- it is what stops a
# loud moment straddling a block boundary from being split into two quieter ones.
BLOCK_STEP_MS = 100

# The absolute gate. Below this a block is silence and must not pull the mean
# down; a track with a long quiet outro would otherwise read quieter than it is.
ABSOLUTE_GATE_LUFS = -70.0

# The relative gate, below the ungated loudness. This is what makes the figure
# describe the RECORD rather than the recording: it discards the passages that
# are quiet relative to the body of the track.
RELATIVE_GATE_LU = -10.0

# Oversampling factor for true peak. 4x is what BS.1770-4 requires at 48 kHz.
TRUE_PEAK_OVERSAMPLE = 4


def k_weight(samples: np.ndarray, sample_rate: int = REFERENCE_RATE) -> np.ndarray:
    """The two-stage K-weighting filter, applied in order."""
    if sample_rate != REFERENCE_RATE:
        raise ValueError(f"K-weighting coefficients are the published 48 kHz ones; got {sample_rate}")

    shelved = signal.lfilter(_SHELF_B, _SHELF_A, samples)
    return signal.lfilter(_RLB_B, _RLB_A, shelved)


def _as_channels(samples: np.ndarray) -> np.ndarray:
    """`(frames, channels)`, accepting a 1-D mono array as one channel."""
    return samples.reshape(-1, 1) if samples.ndim == 1 else samples


def integrated_lufs(samples: np.ndarray, sample_rate: int = REFERENCE_RATE) -> float | None:
    """Gated programme loudness, or `None` when nothing survives the gate.

    Takes `(frames, channels)`. **It must be given the real channels rather than
    a downmix**, and this is the single easiest thing to get wrong here, because
    a downmix produces a number that looks entirely plausible:

    BS.1770 SUMS the K-weighted power of each channel. A stereo→mono downmix
    averages them instead, so two uncorrelated channels read about 3 dB low, and
    anti-phase material cancels to nothing at all. Measured against ffmpeg's own
    implementation, uncorrelated noise came back at -18.8 LUFS downmixed against
    a true -15.8, and an anti-phase pair produced no reading whatsoever.

    Real music sits somewhere between: correlated in the middle, decorrelated at
    the sides, so the error is material-dependent and unpredictable, which is
    worse than a constant one would be.

    `None` rather than a very negative number for silence, and the distinction
    matters: a caller computing a gain from a figure like -80 would boost it by
    seventy decibels. Absent means "no opinion", which every consumer of these
    measurements already has to handle.
    """
    if samples.size == 0:
        return None

    channels = _as_channels(samples)

    block = int(sample_rate * BLOCK_MS / 1000)
    step = int(sample_rate * BLOCK_STEP_MS / 1000)
    if channels.shape[0] < block:
        # Shorter than one gating block. Not measurable to the standard, and
        # guessing from a partial block would report a number that looks real.
        return None

    count = 1 + (channels.shape[0] - block) // step

    # Σ G_i · z_i, per block. G is 1.0 for left, right and centre; a surround
    # channel would be 1.41, which nothing here produces because anything wider
    # than stereo is folded down before it arrives. See `app.py`.
    mean_square = np.zeros(count, dtype=np.float64)
    for index in range(channels.shape[1]):
        weighted = k_weight(np.ascontiguousarray(channels[:, index], dtype=np.float64), sample_rate)

        # A strided view so a five-minute track does not become a copy per block.
        blocks = np.lib.stride_tricks.as_strided(
            weighted,
            shape=(count, block),
            strides=(weighted.strides[0] * step, weighted.strides[0]),
            writeable=False,
        )
        mean_square += np.mean(np.square(blocks), axis=1)

    # log10(0) for a wholly silent block; floored so it gates out rather than
    # poisoning the comparison.
    loudness = _OFFSET_DB + 10.0 * np.log10(np.maximum(mean_square, 1e-12))

    above_absolute = loudness > ABSOLUTE_GATE_LUFS
    if not above_absolute.any():
        return None

    ungated = _OFFSET_DB + 10.0 * np.log10(np.mean(mean_square[above_absolute]))
    relative_gate = ungated + RELATIVE_GATE_LU

    kept = above_absolute & (loudness > relative_gate)
    if not kept.any():
        return None

    return float(_OFFSET_DB + 10.0 * np.log10(np.mean(mean_square[kept])))


def true_peak_db(samples: np.ndarray, oversample: int = TRUE_PEAK_OVERSAMPLE) -> float | None:
    """The highest inter-sample peak, in dBTP.

    Oversampled rather than read off the samples, because the waveform between
    two samples can exceed both of them. The difference is routinely around a
    decibel and occasionally several, and it is the difference between a
    computed gain that is safe and one that clips on playback.

    Chunked so a long track does not hold four copies of itself: only the
    running maximum survives each chunk, so peak memory is one chunk rather than
    the whole oversampled signal.
    """
    if samples.size == 0:
        return None

    channels = _as_channels(samples)
    peak = 0.0

    # Per channel, because a peak is a property of what one converter has to
    # reproduce. A downmix would hide a channel that clips on its own.
    for index in range(channels.shape[1]):
        column = np.ascontiguousarray(channels[:, index], dtype=np.float64)

        # A second of audio at a time, with context either side so the
        # resampler's own filter has settled before the part being measured.
        chunk = REFERENCE_RATE
        overlap = 256

        for start in range(0, column.size, chunk):
            lead = min(start, overlap)
            piece = column[start - lead : start + chunk + overlap]
            if piece.size == 0:
                continue

            upsampled = signal.resample_poly(piece, oversample, 1)

            # **Only the middle counts.** `resample_poly` zero-pads what it is
            # given, so each piece ends in a step discontinuity that rings --
            # and the ringing overshoots by up to a decibel, which is a whole
            # decibel of headroom the station would then decline to use. Trimming
            # back to the samples this chunk is actually responsible for is what
            # makes the context either side worth having; without it the overlap
            # merely moves the artifact.
            begin = lead * oversample
            end = begin + chunk * oversample
            middle = upsampled[begin:end]
            if middle.size == 0:
                continue

            peak = max(peak, float(np.max(np.abs(middle))))

    if peak <= 0.0:
        return None
    return float(20.0 * np.log10(peak))


def sample_peak_db(samples: np.ndarray) -> float | None:
    """The highest actual sample, in dBFS.

    Reported alongside the true peak rather than instead of it, because the gap
    between the two is diagnostic: a large one means the master is already
    running into its own ceiling, which is worth knowing before adding gain to
    it.
    """
    if samples.size == 0:
        return None

    peak = float(np.max(np.abs(samples)))
    if peak <= 0.0:
        return None
    return float(20.0 * np.log10(peak))


def to_mono(samples: np.ndarray) -> np.ndarray:
    """The channels folded down for the measurements that want one signal.

    Energy-preserving rather than an average of the samples: `sqrt(mean(x_i^2))`
    keeps anti-phase content instead of cancelling it. The cue points are asking
    "is the record sounding here", and two channels that sum to nothing are still
    a record sounding.

    Not usable for loudness, which needs the channels themselves -- see
    {@link integrated_lufs}.

    **And not usable for anything SPECTRAL**, which is not obvious from the name
    and is the trap worth naming here. Squaring and rooting is a rectification, so
    the result is non-negative and carries harmonics of everything below whatever
    band a caller then looks at. Measured on a 60 Hz bassline in real stereo, the
    energy inside 200 Hz-4 kHz reads **-32.5 dBFS through this against -96.6 dBFS
    from the waveform itself** -- 64 dB of bass lifted into the mid band.
    (Mono files are returned untouched, so the error appears only on stereo, which
    is most of a library and none of the synthetic fixtures.)

    That is harmless for the cue points below, which only ask "is the record
    sounding here" and are calibrated against exactly this signal. It is fatal for
    anything asking WHAT is sounding. A caller that needs to filter wants a plain
    average of the channels instead, and should say why in its own file.
    """
    channels = _as_channels(samples)
    if channels.shape[1] == 1:
        return np.ascontiguousarray(channels[:, 0])

    return np.sqrt(np.mean(np.square(channels.astype(np.float64)), axis=1)).astype(np.float32)
