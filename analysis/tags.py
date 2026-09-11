"""What the file already says about its own loudness.

Pure parsing: takes the tag dictionary ffprobe reports, returns the fields the
station stores. No subprocess and no HTTP, so it can be exercised against the
tag shapes real containers produce.

**These are not measurements and this module does not treat them as such.** A
ReplayGain tag is a CORRECTION written by whoever scanned the file, and a
correction means nothing without the level it was computed against: -6 dB
against a -18 LUFS reference and -6 dB against a -23 LUFS one describe records
that differ by five decibels. So the reference is reported alongside the gain,
and the consumer turns the pair back into an implied loudness that its own target
can be applied to. Reporting the gain alone would be storing an answer to a
question nobody downstream asked.

Why bother when the sidecar measures the loudness anyway: a tag is what the
mastering engineer or the label decided, and the measurement is what this station
guessed. Where the two disagree the tag wins. See
[station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §4.
"""

from __future__ import annotations

import math
import re

# What a ReplayGain tag's numbers are relative to, in LUFS.
#
# ReplayGain 2.0 -- which is what every scanner in current use writes -- targets
# -18 LUFS. The original 1.0 specification expressed the same idea as an SPL
# figure against a different loudness algorithm, and files carrying it are
# indistinguishable from the outside: same tag names, same units, no version
# field anywhere. So this is an ASSUMPTION, and it is the one to revisit if an
# old, correctly tagged record airs consistently a couple of decibels off.
REPLAYGAIN_REFERENCE_LUFS = -18.0

# What an R128 tag's numbers are relative to, in LUFS.
#
# Not an assumption: EBU R128 fixes the reference at -23 LUFS, and the Opus
# specification stores the gain relative to it. This is the tag to trust where a
# file carries both.
R128_REFERENCE_LUFS = -23.0

# The Opus/Ogg fixed-point divisor. `R128_TRACK_GAIN` is an integer in Q7.8, so
# 256 units is one decibel, and reading it as decibels directly is an error of
# two orders of magnitude that still looks like a plausible number.
R128_SCALE = 256.0

# A decimal number, with an optional `dB` suffix that carries no information --
# the units are fixed by the tag's name. Scanners differ on whether they write
# it, on the spacing, and on the case.
_GAIN = re.compile(r"^\s*([+-]?\d+(?:\.\d+)?)\s*(?:dB)?\s*$", re.IGNORECASE)


def gain_tags(tags: dict[str, str]) -> dict[str, float]:
    """The loudness fields a file's own tags support, omitting the rest.

    Omitted rather than defaulted, on the same rule as every other field in this
    sidecar: absent means the file said nothing, which the consumer already knows
    how to handle. A default here would be this module inventing a claim the file
    never made.

    Tag names are matched case-insensitively because the case that reaches
    ffprobe depends on the container -- Vorbis comments are conventionally upper,
    ID3 `TXXX` descriptions are conventionally lower, and neither is guaranteed.
    """
    lowered = {key.lower(): value for key, value in tags.items() if isinstance(value, str)}

    fields: dict[str, float] = {}
    gain = _track_gain(lowered)
    if gain is not None:
        fields["tagGainDb"], fields["tagReferenceLufs"] = gain

    peak = _peak_db(lowered)
    if peak is not None:
        fields["tagPeakDb"] = peak

    return {key: round(value, 2) for key, value in fields.items()}


def _track_gain(tags: dict[str, str]) -> tuple[float, float] | None:
    """The track gain and what it is relative to, R128 first.

    R128 wins where a file carries both, because its reference is specified where
    ReplayGain's is inferred. Album gain is deliberately not read: the station
    plays records in an order nobody sequenced, so preserving the relative levels
    within a release would only make one album quieter than the next.
    """
    r128 = _number(tags.get("r128_track_gain"))
    if r128 is not None:
        return r128 / R128_SCALE, R128_REFERENCE_LUFS

    replaygain = _number(tags.get("replaygain_track_gain"))
    if replaygain is not None:
        return replaygain, REPLAYGAIN_REFERENCE_LUFS

    return None


def _peak_db(tags: dict[str, str]) -> float | None:
    """The tagged peak, converted from ReplayGain's linear scale to dBFS.

    A SAMPLE peak, always, which is why nothing downstream caps a boost with it:
    the sidecar measures a true peak from the samples and that is the number the
    encoder will actually meet. It is stored because the gap between the two is
    worth being able to look at.

    Values above 1.0 are legitimate and common -- a master that already clips
    reports it honestly -- so they are kept rather than clamped, and only a
    non-positive peak is refused, having no logarithm.
    """
    peak = _number(tags.get("replaygain_track_peak"))
    if peak is None or peak <= 0:
        return None

    return 20 * math.log10(peak)


def _number(raw: str | None) -> float | None:
    """A tag value as a number, or nothing at all.

    Anything unparseable is nothing: a tag is written by software this station
    has never met, and a half-read one is worse than an absent one because it
    would be acted on.
    """
    if raw is None:
        return None

    matched = _GAIN.match(raw)
    if matched is None:
        return None

    try:
        value = float(matched.group(1))
    except ValueError:  # pragma: no cover - the pattern already guarantees this parses
        return None

    return value if math.isfinite(value) else None
