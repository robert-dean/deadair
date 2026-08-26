"""Joining several decoded parts into one signal.

The arithmetic half of `POST /join`, kept out of `app.py` for the reason
`measure.py` is: nothing here touches HTTP or a subprocess, so it can be
exercised against a synthetic signal rather than against a real programme.

## Why the station wants this at all

A production -- a phone-in, a podcast, a long bulletin -- is written one beat at
a time, because a beat is one model call in one voice. It used to AIR that way
too: seven turns of a three-minute call were seven items in the running order,
seven hand-overs to the player, and the pause between one turn and the next was
whatever the speech engine's own leading and trailing silence happened to be
plus whatever the transport added. Nothing could tune it, because there was
nothing between the beats to tune.

Joining the beats once they exist makes that pause a NUMBER. Everything else
this buys (one title on the mount, one item to remove, one loudness reading) is
worth having and is not why it is here.

## Trimming is what makes the gap mean anything

A gap inserted between two files that each carry a few hundred milliseconds of
engine padding is not a gap of `gap_ms`; it is `gap_ms` plus two unknowns that
move with the voice and with the line. So each part is trimmed to its own
`cue_in..cue_out` first, with the SAME threshold the station already trims
records with -- see SILENCE_FLOOR_DB in `measure.py`, which is set below the
noise floor of a quiet transfer precisely so a trim does not clip an attack.

Trimming is optional and the caller says. A part that measures as pure silence
is left alone rather than trimmed to nothing: a beat of room tone is a beat
somebody wrote, and a zero-length turn is a worse answer than a quiet one.
"""

from __future__ import annotations

import numpy as np

from loudness import to_mono
from measure import SAMPLE_RATE, measure

# The most parts one call may join.
#
# A ceiling rather than a limit anybody should reach: MAX_BEATS in the station's
# own planner is 24, so this is that with room, and a request past it is a
# mistake upstream rather than a feature-length programme.
MAX_PARTS = 64

# The longest silence that may be asked for between two parts.
#
# Two seconds is already a long pause on air. Past that the caller is describing
# a break in the programme rather than a beat between turns, and a break in the
# programme is two items in the running order.
MAX_GAP_MS = 2000


def trim_to_cues(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """One part with its leading and trailing silence taken off.

    Answers the input unchanged where the measurement gives nothing to cut,
    which covers both degenerate cases at once: a part that is silence all the
    way through (`measure` reports the whole file as the sounding region's
    complement, so the slice would be empty) and one that is already tight.
    """
    if samples.size == 0:
        return samples

    points = measure(to_mono(samples), sample_rate)

    start = max(0, int(points.cue_in * sample_rate / 1000))
    end = min(samples.shape[0], int(points.cue_out * sample_rate / 1000))
    if end <= start:
        return samples

    return samples[start:end]


def join_samples(parts: list[np.ndarray], gap_ms: int, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Several `(frames, channels)` buffers as one, with silence between them.

    BETWEEN them and never at the ends: what is being made is one item in a
    running order, and padding its head or tail would put back exactly the dead
    air the trim just took off -- with the station's own cue points then unable
    to tell that silence apart from a slow first word.

    Every part must carry the same channel count. The caller decodes them, so it
    is the caller's job to have decided that; disagreement here is a programming
    error rather than a bad request, and it raises rather than folding, because
    folding a stereo turn into a mono programme in silence is the kind of thing
    nobody notices until it airs.
    """
    if not parts:
        raise ValueError("there is nothing to join")
    if len(parts) > MAX_PARTS:
        raise ValueError(f"more than {MAX_PARTS} parts")
    if gap_ms < 0 or gap_ms > MAX_GAP_MS:
        raise ValueError(f"a gap of {gap_ms}ms is outside 0..{MAX_GAP_MS}")

    channels = parts[0].shape[1]
    if any(part.shape[1] != channels for part in parts):
        raise ValueError("the parts do not agree about how many channels they have")

    gap_frames = int(gap_ms * sample_rate / 1000)
    gap = np.zeros((gap_frames, channels), dtype=np.float32)

    pieces: list[np.ndarray] = []
    for index, part in enumerate(parts):
        if index > 0 and gap_frames > 0:
            pieces.append(gap)
        pieces.append(part.astype(np.float32, copy=False))

    return np.concatenate(pieces, axis=0)


def duration_ms(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> int:
    """How long a joined buffer runs, which is what the station stores on the row."""
    return int(samples.shape[0] * 1000 / sample_rate)


# The most overlays one call may place.
#
# Well above what the station asks for (one pad in a break) and low enough that a
# malformed request cannot turn one join into an hour of array arithmetic.
MAX_OVERLAYS = 16

# How far either side of a join an overlay may be nudged.
#
# Three seconds, which is the longest a sound can start before the words end and
# still be the same moment rather than a second thing happening. Past that the
# caller is describing a bed, and a bed wants a span rather than an anchor.
MAX_OFFSET_MS = 3000


def join_offsets(parts: list[np.ndarray], gap_ms: int, sample_rate: int = SAMPLE_RATE) -> list[int]:
    """Where each join FALLS in the buffer `join_samples` builds, in frames.

    One entry per boundary, so `n` parts give `n - 1` offsets and a single part
    gives none. Computed rather than measured, because it has to agree exactly
    with the concatenation beside it -- two functions that each decide where a
    boundary is are two functions that can disagree by a frame, and an overlay
    anchored to the wrong one lands in the middle of a word.
    """
    gap_frames = int(gap_ms * sample_rate / 1000)
    offsets: list[int] = []
    at = 0

    for part in parts[:-1]:
        at += part.shape[0]
        offsets.append(at)
        # The gap that follows this part, which the next one starts after.
        at += gap_frames

    return offsets


def place_overlay(
    base: np.ndarray,
    overlay: np.ndarray,
    at_frame: int,
    gain_db: float = 0.0,
    duck_db: float = 0.0,
) -> np.ndarray:
    """One sound mixed into a buffer at a frame, with the buffer ducked under it.

    Mixed rather than inserted, which is the whole difference between this and
    `join_samples`: nothing moves, so the words either side of a drop keep the
    timing they were spoken with and the drop happens ON them.

    `at_frame` may be negative or past the end; both are clipped to what actually
    overlaps, so an offset that would put a sound before the first word simply
    starts it at the first word rather than raising. A caller nudging an overlay
    around a boundary should not have to know how long the parts were.

    `duck_db` attenuates the base for the overlay's SPAN only, which is what makes
    a sound audible over speech without turning the speech down for the whole
    break. It is applied before the sum rather than after, or the duck would pull
    the overlay down with it.
    """
    if overlay.size == 0 or base.size == 0:
        return base

    mixed = base.astype(np.float32, copy=True)

    start = max(0, at_frame)
    end = min(base.shape[0], at_frame + overlay.shape[0])
    if end <= start:
        return mixed

    # Which slice of the overlay actually lands, for the case where it starts
    # before the buffer does.
    taken = overlay[start - at_frame : end - at_frame]

    if duck_db != 0.0:
        mixed[start:end] *= np.float32(10.0 ** (duck_db / 20.0))

    mixed[start:end] += taken.astype(np.float32, copy=False) * np.float32(10.0 ** (gain_db / 20.0))

    return mixed


def with_headroom(samples: np.ndarray) -> np.ndarray:
    """The same buffer, scaled down if summing pushed it past full scale.

    A LINEAR scale of the whole thing rather than a limiter, and that is a real
    choice rather than the lazy one. A limiter would keep the loud moment loud and
    change the shape of it, which is a decision about how the station sounds that
    belongs to whoever masters the audio; scaling changes no shape at all. What it
    costs -- the whole break coming out quieter -- costs nothing here, because the
    station MEASURES what it made and stamps a gain from that measurement on the
    way to the mount. Only the ratio between the words and the sound survives this
    function, and the ratio is the part the caller actually asked for.

    Untouched when nothing clipped, so an ordinary join is bit-identical to one
    made before overlays existed.
    """
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1.0:
        return samples

    return (samples / np.float32(peak)).astype(np.float32, copy=False)
