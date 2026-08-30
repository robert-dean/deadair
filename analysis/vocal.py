"""Where the singing starts, and how present a voice is over the record.

Pure measurement in `measure.py`'s shape: an envelope in, offsets out. No HTTP,
no subprocess and no config, so it can be exercised against a synthetic signal.

## Band energy alone would measure nothing new, and that is the whole design

`docs/decisions/analysis-licensing.md` describes what computes these fields as
"band-limited energy, 200 Hz to 4 kHz". It is right that no separation toolkit is
needed -- there is no model here and no weights, so its permissive rule is
untouched -- and that one line is not the feature. That band is exactly what
`intro_end` already uses, because it is where "voices and lead instruments live".
A plain band envelope would re-derive `intro_end` under a new name.

What separates a sung line from a sustained lead is that a voice is
SYLLABIC: its level rises and falls a few times a second, where a held guitar
note or a pad does not. So this measures the envelope's own modulation in the
2-8 Hz band, relative to the level it is modulating -- the classic speech/music
discriminator, and pure `scipy.signal`.

The figure has a physical meaning worth keeping. For an envelope
`A(1 + m sin(2 pi f t))` the AC part has RMS `A m / sqrt(2)`, so the ratio this
reports is the modulation DEPTH over root two: 0.35 is a voice moving the level
by about half, and a steady tone is 0.

## Being wrong early is much cheaper than being wrong late

A vocal onset reported too LATE puts a talk-up over the first word, which
`docs/todo/track-lyrics.md` calls the single most audible mistake a radio station
makes. One reported too EARLY costs talk-up time nobody hears the absence of. So
every choice here leans early: the curve takes the MAXIMUM in each bin rather
than the mean, and the threshold is tuned down rather than up.

The smoothing leans the same way for free, and it is worth knowing rather than
rediscovering. `_moving_mean` is CENTRED, so a line entering raises the presence
about half a window before the first word actually lands -- the onset reads
roughly half a second early. That is the safe direction, so it is left alone
rather than corrected for.

## An absent onset is an answer

A record whose presence never sustains reports no onset at all, and that is the
honest reading of an instrumental rather than a failure to measure one. The
distinction is carried by {@link VocalPresence.curve}, which is ALWAYS produced:
a row with a curve and no onset was looked at and had no sustained vocal, and a
row with neither was never looked at. Nothing else in the stored blob can tell
those apart.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal

from measure import HOP_MS, SAMPLE_RATE, SILENCE_FLOOR_DB, CuePoints, band_envelope, hop_for

# The rate the envelope itself is sampled at, in Hz. 10 ms frames, so 100.
ENVELOPE_RATE = 1000.0 / HOP_MS

# The modulation band a voice lives in.
#
# Syllables land at roughly two to eight a second in sung and spoken English
# alike, and the bottom of that range is the load-bearing end: below about 2 Hz
# is phrasing and arrangement -- a chord change, a bar -- which every instrument
# does too. The top is generous rather than tight, because a fast delivery and a
# rolled consonant both put energy above six.
SYLLABIC_HZ = (2.0, 8.0)

# The window the level and its modulation are both measured over.
#
# A second, which is two to eight syllables: long enough that one word does not
# read as a voice and short enough that a line entering is seen within a beat or
# two of entering. It is also why `VOCAL_SUSTAIN_MS` below is not shorter than
# this -- a sustain requirement inside one window is not a second opinion.
LEVEL_WINDOW_MS = 1000

# Below these the record is not sounding in this band and there is nothing to be
# modulating. TWO floors, and the absolute one is the load-bearing half.
#
# **A ratio is scale-invariant, which is the trap.** Presence is modulation over
# level, so a signal attenuated to nothing by the band-pass and then divided by
# its own residual reports the same figure as a loud one. Measured: a 60 Hz bass
# modulated at syllable rate leaks through at -96.6 dBFS and read 0.61 -- a
# confident vocal, on a bassline, on every dance record in the library.
#
# A RELATIVE floor cannot catch that, because a track made entirely of leakage
# sets its own reference from the leakage. This is the same insight the dead-air
# trim carries in `docs/todo/comparable-stations.md` -- silence has to be measured
# against an absolute floor rather than against the track's own loud level -- read
# in mirror image.
#
# So the absolute one is `SILENCE_FLOOR_DB`, reused from `measure.py` because it
# is the same question about the same envelope and its reasoning is already
# written down there. It separates cleanly: that bass residual is -96.6 dBFS and a
# very quietly mastered tone is -43. It is applied PER FRAME, unlike the relative
# one -- see `presence_of` for the second thing that buys.
#
# The relative one stays beside it and does a different job: a passage far below
# the record's own level is not the one carrying the vocal, however audible it is.
QUIET_FRACTION = 0.02
ABSOLUTE_FLOOR = 10.0 ** (SILENCE_FLOOR_DB / 20.0)

# How much modulation counts as a voice.
#
# PROVISIONAL. `apps/api/scripts/vocal.calibration.ts` runs this over the real
# library and the number that ships is the one that pass produces -- a threshold
# a detector shipped with by default is what broke a comparable station's cue
# points, and `docs/todo/track-analysis.md` asks for a measured one in as many
# words. 0.20 is a modulation depth of about 28%, which is a starting point and
# not a finding.
VOCAL_THRESHOLD = 0.20

# How long the presence has to hold above it before an onset is called.
#
# `_first_sustained`'s argument in `measure.py`, one layer up: a single word over
# an instrumental opening -- a count-in, a shouted "yeah" -- is not the vocal
# starting. A line that keeps going is.
#
# **Twice LEVEL_WINDOW_MS, and equalling it would be no requirement at all.** The
# moving RMS above smears a burst across a whole window either side of itself, so
# a 0.4s shout already produces about a second of presence above the threshold on
# its own. Measured before this was doubled: that shout returned an onset. A
# sustain requirement has to outlast the smoothing that feeds it.
#
# It does not delay the answer, because the onset is reported at the START of the
# run rather than at its end. What it costs is a record whose vocal enters and
# stops inside two seconds, which reports none.
VOCAL_SUSTAIN_MS = 2 * LEVEL_WINDOW_MS

# How coarsely the curve is stored. `docs/todo/track-analysis.md` asks for "a
# value every half second", which is finer than either consumer's decision.
CURVE_MS = 500


@dataclass(frozen=True)
class VocalPresence:
    """What one record's voice looks like over time."""

    # 0-100 per CURVE_MS, from the start of the FILE rather than from `cue_in`,
    # so an index maps to a timestamp without the reader holding a second number.
    curve: list[int]
    # Absolute ms into the file, or None where nothing sustained. See the class note.
    onset: int | None

    def as_data(self) -> dict:
        """The wire shape. camelCase because it is stored and read as JSON.

        The curve is always present and the onset is not, which is what lets a
        reader tell an instrumental from a row written before this existed.
        """
        return {"vocalCurve": self.curve, **({} if self.onset is None else {"vocalOnset": self.onset})}


def presence_of(envelope: np.ndarray) -> np.ndarray:
    """Per-frame vocal presence in [0, 1], from the band envelope alone.

    The three steps are the whole method: take the local level, take the
    2-8 Hz modulation around it, and report their ratio.

    `sosfiltfilt` again, for `band_envelope`'s reason read one layer up: a causal
    filter would delay the modulation relative to the level it is being divided
    by, which moves an onset by exactly the amount the filter's group delay
    happens to be.
    """
    if envelope.size == 0:
        return np.zeros(0, dtype=np.float32)

    window = max(1, int(LEVEL_WINDOW_MS / HOP_MS))
    level = _moving_mean(envelope.astype(np.float64), window)

    # Both floors, against the WINDOWED level rather than the instantaneous
    # envelope, and that is a correction rather than a shortcut. Applying the
    # absolute one per frame is the obvious-looking version and it zeroes the
    # presence at every syllable TROUGH -- a fully modulated line touches zero
    # between words, so the run of frames an onset needs is punched full of holes
    # and no onset is ever found. Measured: it took out both onset tests at once.
    reference = float(np.percentile(envelope, 75)) if envelope.size > 0 else 0.0
    floor = max(ABSOLUTE_FLOOR, reference * QUIET_FRACTION)

    # `padlen` is scipy's own requirement and a short clip simply has no
    # measurable modulation, which is the honest answer for one.
    order = 2
    padlen = 3 * (2 * order + 1)
    if envelope.size <= padlen:
        return np.zeros(envelope.size, dtype=np.float32)

    sos = signal.butter(order, SYLLABIC_HZ, btype="bandpass", fs=ENVELOPE_RATE, output="sos")
    modulation = signal.sosfiltfilt(sos, envelope.astype(np.float64))

    # RMS of the modulation over the same window the level is taken over, so the
    # ratio compares two things measured across the same stretch of record.
    depth = np.sqrt(_moving_mean(np.square(modulation), window))

    presence = np.divide(depth, level, out=np.zeros_like(depth), where=level > floor)
    return np.clip(presence, 0.0, 1.0).astype(np.float32)


def measure_vocals(samples: np.ndarray, points: CuePoints, sample_rate: int = SAMPLE_RATE) -> VocalPresence:
    """The curve and the onset for one record.

    `samples` must be a WAVEFORM -- `to_downmix`, not `to_mono`. The band envelope
    is a spectral reading and `to_mono` rectifies, which lifts a bassline into the
    vocal band by 64 dB and makes every stereo record with one read as singing.
    That is why this measures its own envelope rather than sharing the cue
    points', which are calibrated against the rectified signal and must keep
    reading it.

    `points` bounds BOTH: the leading and trailing silence are not part of the
    record, so they carry no presence at all. The curve still covers the whole
    file, so its indices are file time -- what every offset in this service is --
    the silence simply reads zero.

    That zeroing is a fix rather than tidiness. Every window in `presence_of` is
    CENTRED, so inside the leading silence they already reach forward into the
    audio: the level comes back above the floor and the step at `cue_in` fills the
    modulation term, and a record with half a second of silence at the top
    reported a presence of 1.0 across samples whose envelope is exactly zero.
    """
    envelope = band_envelope(samples, hop_for(sample_rate))
    presence = presence_of(envelope)

    # Outside the sounding region, in FRAMES, which is what the envelope is in.
    sounding = np.zeros(presence.size, dtype=bool)
    sounding[max(0, points.cue_in // HOP_MS) : max(0, points.cue_out // HOP_MS)] = True
    presence = np.where(sounding, presence, 0.0).astype(np.float32)

    return VocalPresence(curve=_binned(presence), onset=_onset_in(presence, points))


def _onset_in(presence: np.ndarray, points: CuePoints) -> int | None:
    """The first sustained crossing after `cue_in`, or None.

    `None` rather than a fallback to `cue_in` or to `intro_end`, deliberately.
    Both of those are numbers the consumer already has, and answering with one of
    them here would tell it a vocal was found where none was -- which is the
    difference between a station that knows a record is instrumental and one that
    thinks it heard singing at the top.
    """
    need = max(1, VOCAL_SUSTAIN_MS // HOP_MS)
    first = max(0, points.cue_in // HOP_MS)
    last = max(first, points.cue_out // HOP_MS)

    region = presence[first:last]
    if region.size < need:
        return None

    above = (region >= VOCAL_THRESHOLD).astype(np.int32)
    runs = np.convolve(above, np.ones(need, dtype=np.int32), mode="valid")
    hits = np.flatnonzero(runs >= need)
    if hits.size == 0:
        return None

    at = (first + int(hits[0])) * HOP_MS
    # Held inside the sounding region rather than trusted to be: the search is
    # already bounded, and a consumer that seeks outside the audio gets silence
    # rather than an error anybody sees.
    return min(max(at, points.cue_in), points.cue_out)


def _binned(presence: np.ndarray) -> list[int]:
    """The curve at CURVE_MS, as integers 0-100.

    The MAXIMUM in each bin, not the mean, and that is the early-rather-than-late
    rule in the class note applied to storage: a bin holding the first half-second
    of a line should read as a bin with singing in it. The moving RMS above has
    already smoothed the input, so there is no single spurious frame for a max to
    seize on.

    Integers because they halve the stored blob and are finer than either
    consumer's decision, which is `HOP_MS`'s own argument one layer down.
    """
    per_bin = max(1, CURVE_MS // HOP_MS)
    if presence.size == 0:
        return []

    # Padded to a whole number of bins with the value zero, so a final part-bin
    # is reported rather than dropped: the curve's length is what a reader turns
    # into a timeline.
    short = (-presence.size) % per_bin
    padded = np.pad(presence, (0, short), mode="constant")

    return [int(round(value * 100)) for value in padded.reshape(-1, per_bin).max(axis=1)]


def _moving_mean(values: np.ndarray, window: int) -> np.ndarray:
    """Moving average, same length, edges handled by edge padding. `_smooth`'s shape."""
    if window <= 1 or values.size == 0:
        return values

    padded = np.pad(values, (window // 2, window - 1 - window // 2), mode="edge")
    kernel = np.ones(window, dtype=np.float64) / float(window)
    return np.convolve(padded, kernel, mode="valid")
