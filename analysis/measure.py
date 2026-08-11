"""Finding the four points in one decoded track.

Pure measurement: takes samples, returns offsets. No HTTP, no subprocess, no
config, so it can be exercised against a synthetic signal without a container.

The whole module is built around one asymmetry. `cue_in` and `cue_out` are a
level threshold and nothing more, and they are most of the audible benefit.
`intro_end` and `outro_start` decide how a transition sounds and are where every
naive implementation goes wrong, in a specific way documented at BAND_HZ.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal

from loudness import REFERENCE_RATE

SCHEMA_VERSION = 1

# One decode serves both this file and `loudness.py`, so the rate is the one
# BS.1770 specifies its filters at. Nothing here needs 48 kHz -- no measurement
# below looks above 4 kHz -- but re-deriving the K-weighting coefficients for a
# lower rate is the step most likely to be quietly wrong, and decoding twice to
# avoid it would cost far more than the extra samples do.
SAMPLE_RATE = REFERENCE_RATE

# Envelope resolution. 10 ms is finer than any decision made from it -- the
# sustain windows below are measured in hundreds of milliseconds -- but it costs
# nothing and it keeps `cue_in` tight enough that a trim does not clip an
# attack.
HOP_MS = 10

# The floor that separates "audio" from "silence", in dBFS.
#
# -60 rather than something higher because it has to sit below the noise floor
# of a quiet analogue transfer while staying above true digital silence. A
# threshold at -40 trims the first breath off a soft opening, which is worse
# than leaving 200 ms of room tone in.
SILENCE_FLOOR_DB = -60.0

# The band the intro/outro envelope is measured over.
#
# THIS IS THE LOAD-BEARING CONSTANT IN THE FILE. A full-band or low-weighted
# envelope places `outro_start` too early on a quiet ending, because the bass
# leaves before the record does -- and a quiet ending is exactly the case an
# ending-aware transition exists to serve, so the naive version fails hardest
# where it matters most.
#
# 200 Hz-4 kHz is where voices and lead instruments live, which is what a
# listener is actually tracking when they hear a record as "still going". The
# bass is deliberately excluded rather than merely de-weighted.
BAND_HZ = (200.0, 4000.0)

# Fraction of the reference level the envelope must reach to count as "the
# record is underway" / "the record is still here".
#
# Half, in amplitude terms, is about -6 dB relative to the body of the track.
# Higher and a record with a sparse verse reads as still being in its intro;
# lower and a fade-in counts as underway before anyone would say it was.
LEVEL_FRACTION = 0.5

# How long the envelope has to hold above the threshold before `intro_end` is
# called. A single loud transient in an ambient opening is not the record
# starting; half a second of sustained level is.
SUSTAIN_MS = 500

# Where the reference level is taken from inside the sounding region. The 75th
# percentile rather than the max, so one clipped snare does not set the bar for
# the whole record, and rather than the mean, which a long quiet intro drags
# down.
REFERENCE_PERCENTILE = 75


@dataclass(frozen=True)
class CuePoints:
    """The four points, in integer milliseconds, absolute into the file."""

    cue_in: int
    intro_end: int
    outro_start: int
    cue_out: int

    def as_data(self) -> dict[str, int]:
        """The wire shape. camelCase because it is stored and read as JSON."""
        return {
            "cueIn": self.cue_in,
            "introEnd": self.intro_end,
            "outroStart": self.outro_start,
            "cueOut": self.cue_out,
        }


def _frame(samples: np.ndarray, hop: int) -> np.ndarray:
    """Reshape into non-overlapping frames of `hop`, dropping any short tail."""
    usable = (len(samples) // hop) * hop
    if usable == 0:
        return np.zeros((0, hop), dtype=np.float32)
    return samples[:usable].reshape(-1, hop)


def _rms_db(frames: np.ndarray) -> np.ndarray:
    """Per-frame RMS in dBFS, with true silence floored rather than -inf."""
    if frames.shape[0] == 0:
        return np.zeros(0, dtype=np.float32)
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
    # Clamp before the log: an all-zero frame is legitimate (digital silence at
    # the head of a file) and log(0) would poison every comparison downstream.
    return 20.0 * np.log10(np.maximum(rms, 1e-10))


def _band_envelope(samples: np.ndarray, hop: int) -> np.ndarray:
    """Per-frame energy inside BAND_HZ.

    One band-pass over the whole signal, then RMS per frame. An earlier version
    ran an FFT per frame instead, which was fine at a low analysis rate and is
    not at 48 kHz: the spectrum of a five-minute track framed at 10 ms is a
    complex array several times the size of the audio, per worker.

    `sosfiltfilt` rather than `sosfilt`, and that is not a detail. A causal IIR
    delays what it passes, and the delay is frequency-dependent -- so the
    envelope would lag the audio by a few milliseconds that vary across the
    band, which is exactly the kind of smearing that moves an onset. Filtering
    forwards and backwards cancels it, and the price (double the effective
    order, and no ability to stream) costs nothing here because the whole track
    is already in memory.
    """
    if samples.size == 0:
        return np.zeros(0, dtype=np.float32)

    sos = signal.butter(4, BAND_HZ, btype="bandpass", fs=SAMPLE_RATE, output="sos")

    # filtfilt needs a few times the filter order to work with; a very short clip
    # is left unfiltered rather than raising, since the caller's own degenerate
    # cases already cover what to do with the answer.
    padlen = 3 * (2 * 4 + 1)
    banded = signal.sosfiltfilt(sos, samples.astype(np.float64)) if samples.size > padlen else samples.astype(np.float64)

    frames = _frame(banded, hop)
    if frames.shape[0] == 0:
        return np.zeros(0, dtype=np.float32)

    return np.sqrt(np.mean(np.square(frames), axis=1)).astype(np.float32)


def _smooth(values: np.ndarray, window: int) -> np.ndarray:
    """Moving average, same length, edges handled by edge padding."""
    if window <= 1 or values.size == 0:
        return values
    padded = np.pad(values, (window // 2, window - 1 - window // 2), mode="edge")
    kernel = np.ones(window, dtype=np.float32) / float(window)
    return np.convolve(padded, kernel, mode="valid")


def measure(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> CuePoints:
    """The four points for one mono, float32, `sample_rate` signal.

    Returns points that are always ordered and always inside the file, because
    every consumer seeks with them: `cue_in <= intro_end <= outro_start <=
    cue_out`. Degenerate input (silence, a file shorter than one frame) collapses
    to a defined answer rather than raising -- an unmeasurable track still has to
    play, and the caller decides what to do with a zero-length sounding region.
    """
    hop = max(1, int(sample_rate * HOP_MS / 1000))
    total_ms = int(len(samples) * 1000 / sample_rate)

    level_db = _rms_db(_frame(samples, hop))
    if level_db.size == 0:
        return CuePoints(0, 0, total_ms, total_ms)

    sounding = np.flatnonzero(level_db > SILENCE_FLOOR_DB)
    if sounding.size == 0:
        # Silence all the way through. Say so honestly: a zero-length sounding
        # region, not a guess at where the record might have been.
        return CuePoints(0, 0, total_ms, total_ms)

    first, last = int(sounding[0]), int(sounding[-1])
    cue_in_ms = first * HOP_MS
    # The END of the last sounding frame, not its start: `cue_out` is where audio
    # stops, and a frame that crossed the floor is audible for its whole length.
    cue_out_ms = min(total_ms, (last + 1) * HOP_MS)

    envelope = _smooth(_band_envelope(samples, hop), window=max(1, SUSTAIN_MS // HOP_MS))
    region = envelope[first : last + 1]
    if region.size == 0:
        return CuePoints(cue_in_ms, cue_in_ms, cue_out_ms, cue_out_ms)

    reference = float(np.percentile(region, REFERENCE_PERCENTILE))
    threshold = reference * LEVEL_FRACTION

    intro_end_ms = _first_sustained(region, threshold, first)
    outro_start_ms = _last_above(region, threshold, first)

    # Order them rather than trusting the two searches to agree. They can
    # disagree legitimately -- a record that never reaches its own reference for
    # a sustained window has no intro in this sense -- and a consumer that seeks
    # to an out-of-order pair produces silence, not an error anybody sees.
    intro_end_ms = min(max(intro_end_ms, cue_in_ms), cue_out_ms)
    outro_start_ms = min(max(outro_start_ms, intro_end_ms), cue_out_ms)

    return CuePoints(cue_in_ms, intro_end_ms, outro_start_ms, cue_out_ms)


def _first_sustained(region: np.ndarray, threshold: float, offset_frames: int) -> int:
    """Where the envelope first holds above `threshold` for SUSTAIN_MS.

    Sustain rather than a first crossing, because one loud transient over an
    ambient opening is not the record starting. A region that never sustains
    reports its end, which reads downstream as "no usable intro" rather than as
    an intro of zero length.
    """
    need = max(1, SUSTAIN_MS // HOP_MS)
    above = region >= threshold
    if above.size < need:
        return (offset_frames + region.size) * HOP_MS

    # A run of `need` consecutive True values is a windowed sum equal to `need`.
    runs = np.convolve(above.astype(np.int32), np.ones(need, dtype=np.int32), mode="valid")
    hits = np.flatnonzero(runs >= need)
    if hits.size == 0:
        return (offset_frames + region.size) * HOP_MS
    return (offset_frames + int(hits[0])) * HOP_MS


def _last_above(region: np.ndarray, threshold: float, offset_frames: int) -> int:
    """The last moment the record was still at full level: where the ending begins.

    No sustain requirement here, and that asymmetry is deliberate. An intro is
    "when did this properly start", which a transient should not answer. An outro
    is "when did it stop being fully present", and the last hit is the honest
    answer to that even if it is brief -- a final stab is the record still being
    there.
    """
    above = np.flatnonzero(region >= threshold)
    if above.size == 0:
        return offset_frames * HOP_MS
    return (offset_frames + int(above[-1])) * HOP_MS
