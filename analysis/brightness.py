"""How bright a record sounds: where its spectrum's weight sits, as one figure in hertz.

Pure measurement: takes samples, returns a number or nothing. No HTTP, no subprocess, no config.

## What it is for

It is half of a record's ENERGY. The other half is its loudness, which `loudness.py` already
measures; the station ranks each against its own library and averages the two ranks, so this file
answers only the absolute question and never "bright compared to what". Measured on 40 records drawn
at random from a real library, against felt-energy scores written down before any figure was
computed, the pair agreed with an ear better than either alone and better than the alternatives that
cost more (onset rate, a harmonic/percussive split, tempo). README.md, "How brightness is measured",
has the table.

## What it is

The SPECTRAL CENTROID of each frame, `sum(f * power(f)) / sum(power(f))`, and the median of that over
every frame where the record is sounding. A tone at 200 Hz reads 200; white noise reads half the
Nyquist frequency; a record reads wherever the weight of its sound sits, which on real music runs from
about 130 Hz (dark, bass-led club records) to 1,500 Hz (bright, cymbal-heavy rock).

- **The median, not the mean**, so a cymbal crash or a dark breakdown moves it as little as one frame
  should.
- **Sounding frames only**, by the cue points' own -60 dBFS floor, so the hiss of a long fade or a
  silent hidden-track gap does not drag it toward the noise floor's colour.
- **Invariant to gain**, which is the point of pairing it with loudness: turning a record up must move
  the loudness half of its energy and leave this half where it was. Only the sounding floor sees the
  level at all.

## What it reads, and what it must not read

**A plain average of the channels, resampled to 22.05 kHz**: exactly the signal the beat tracker
already reads (`beat_model.model_signal`), so one signal serves both. **Never `loudness.to_mono`**,
which folds as `sqrt(mean(x_i^2))`: that is a rectification, and it lifted a 60 Hz bassline into the
mid band by 64 dB when something spectral read it once. Anti-phase content cancels in an average;
that is rare in a mastered record, and a centroid of what remains is still a fair reading.

## Memory

Frame by frame in passes, never the whole record's spectrogram at once. A thirty-minute record is
77,000 frames of 513 bins, about 320 MB as complex numbers, which on the machine this runs beside
would be the single largest allocation in a measurement. A pass is a few megabytes.
"""

from __future__ import annotations

import numpy as np

# The rate the averaged signal arrives at. `beat_model.MODEL_RATE` is the same number; it is repeated
# here rather than imported so this module never imports the beat tracker's.
RATE = 22050

# 46 ms frames, half overlapping: fine enough that a drum hit is its own frame and coarse enough that a
# bass note's fundamental falls in a bin of its own.
FRAME = 1024
HOP = 512

# The cue points' floor (`measure.SILENCE_FLOOR_DB`), for the same reason: below it is silence or the
# noise under a fade, and neither is the record's colour.
SILENCE_FLOOR_DB = -60.0

# Fewer sounding seconds than this and there is no figure: a jingle, a sting or a broken file is not a
# record whose brightness anything should lean on. Absent is an answer every reader already has.
MIN_SOUNDING_SECONDS = 20.0

# How many frames are transformed at once. About 2,000 frames of 1,024 samples is 8 MB of float32 in,
# and the spectrum of a pass about twice that.
FRAMES_PER_PASS = 2048

_FREQUENCIES = np.fft.rfftfreq(FRAME, d=1.0 / RATE)
_WINDOW = np.hanning(FRAME).astype(np.float32)
_FLOOR_POWER = 10.0 ** (SILENCE_FLOOR_DB / 10.0)


def brightness_hz(mono: np.ndarray, rate: int = RATE) -> float | None:
    """The median spectral centroid of the sounding frames, in hertz, or None.

    `mono` is one channel at {@link RATE}: the channels AVERAGED, never rectified. None for a signal
    with fewer than {@link MIN_SOUNDING_SECONDS} of sounding frames.
    """
    if rate != RATE:
        raise ValueError(f"brightness is measured at {RATE} Hz, not {rate}")
    if mono.ndim != 1:
        raise ValueError("brightness reads one channel: average the channels first")

    frames = 0 if len(mono) < FRAME else 1 + (len(mono) - FRAME) // HOP
    if frames == 0:
        return None

    windows = np.lib.stride_tricks.sliding_window_view(mono.astype(np.float32, copy=False), FRAME)[::HOP]
    centroids: list[np.ndarray] = []
    for start in range(0, frames, FRAMES_PER_PASS):
        chunk = windows[start : start + FRAMES_PER_PASS]
        # Whether a frame is sounding is read off the samples themselves, before the window shapes them.
        sounding = np.mean(np.square(chunk, dtype=np.float64), axis=1) > _FLOOR_POWER
        if not sounding.any():
            continue
        power = np.square(np.abs(np.fft.rfft(chunk[sounding] * _WINDOW, axis=1)))
        total = power.sum(axis=1)
        # A sounding frame always carries power, but a frame of pure DC carries it all in bin 0 and
        # reads 0 Hz, which is the truth about it rather than a division to guard.
        centroids.append((power @ _FREQUENCIES) / np.maximum(total, 1e-20))

    if not centroids:
        return None
    found = np.concatenate(centroids)
    if found.size * HOP / RATE < MIN_SOUNDING_SECONDS:
        return None
    return round(float(np.median(found)), 1)
