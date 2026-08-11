"""What a file's own loudness tags parse to.

Every case here is a real shape some scanner writes. There is no standard for
the formatting -- the units in the value are redundant with the tag's name, the
case depends on the container, and the R128 form is not decimal decibels at all
-- so the failures this guards against are all the same kind: a number that
parses to something plausible and wrong, which then moves a record by the wrong
amount with total confidence.

    python3 -m pytest analysis/test_tags.py
"""

from __future__ import annotations

import pytest

from tags import R128_REFERENCE_LUFS, REPLAYGAIN_REFERENCE_LUFS, gain_tags


def test_reads_a_replaygain_track_gain():
    parsed = gain_tags({"replaygain_track_gain": "-6.54 dB"})

    assert parsed["tagGainDb"] == -6.54
    assert parsed["tagReferenceLufs"] == REPLAYGAIN_REFERENCE_LUFS


@pytest.mark.parametrize(
    "written",
    ["-6.54 dB", "-6.54dB", "-6.54", " -6.54 dB ", "-6.54 DB"],
)
def test_accepts_every_spelling_scanners_actually_write(written):
    # The suffix carries no information -- the tag's name fixes the units -- so a
    # scanner that omits it is not saying something different.
    assert gain_tags({"replaygain_track_gain": written})["tagGainDb"] == -6.54


def test_reads_a_positive_gain():
    assert gain_tags({"replaygain_track_gain": "+3.21 dB"})["tagGainDb"] == 3.21


def test_matches_tag_names_whatever_their_case():
    # Vorbis comments are conventionally upper, ID3 TXXX descriptions lower, and
    # neither is guaranteed to reach ffprobe as written.
    assert gain_tags({"REPLAYGAIN_TRACK_GAIN": "-8 dB"})["tagGainDb"] == -8.0


def test_converts_an_r128_gain_out_of_q7_8():
    # The one that is not decibels. -1536 is -6 dB, and reading the integer as dB
    # would be a correction two orders of magnitude too large that still looks
    # like a number somebody could have meant.
    parsed = gain_tags({"R128_TRACK_GAIN": "-1536"})

    assert parsed["tagGainDb"] == -6.0
    assert parsed["tagReferenceLufs"] == R128_REFERENCE_LUFS


def test_prefers_r128_where_a_file_carries_both():
    # R128's reference is specified; ReplayGain's is inferred. Where the file
    # states one, the station should not be guessing.
    parsed = gain_tags({"R128_TRACK_GAIN": "-1536", "replaygain_track_gain": "-2 dB"})

    assert parsed["tagGainDb"] == -6.0
    assert parsed["tagReferenceLufs"] == R128_REFERENCE_LUFS


def test_ignores_album_gain():
    # The station plays records in an order nobody sequenced, so album gain would
    # only make one release quieter than the next.
    assert gain_tags({"replaygain_album_gain": "-9 dB"}) == {}


def test_converts_the_peak_out_of_replaygain_s_linear_scale():
    assert gain_tags({"replaygain_track_peak": "1.0"})["tagPeakDb"] == 0.0
    assert gain_tags({"replaygain_track_peak": "0.5"})["tagPeakDb"] == -6.02


def test_keeps_a_peak_that_is_already_over_full_scale():
    # A master that clips reports it honestly, and clamping would erase exactly
    # the case worth knowing about.
    assert gain_tags({"replaygain_track_peak": "1.12"})["tagPeakDb"] == pytest.approx(0.98, abs=0.01)


def test_refuses_a_peak_with_no_logarithm():
    assert gain_tags({"replaygain_track_peak": "0"}) == {}
    assert gain_tags({"replaygain_track_peak": "-0.5"}) == {}


def test_omits_what_the_file_never_said():
    # Absent is the answer, not a default. A default here would be inventing a
    # claim on the file's behalf.
    assert gain_tags({}) == {}
    assert gain_tags({"title": "Hangar 18", "artist": "Megadeth"}) == {}


def test_refuses_anything_unparseable_rather_than_half_reading_it():
    # These tags are written by software this station has never met.
    assert gain_tags({"replaygain_track_gain": "loud"}) == {}
    assert gain_tags({"replaygain_track_gain": ""}) == {}
    assert gain_tags({"replaygain_track_gain": "-6.54 dB (album)"}) == {}
    assert gain_tags({"R128_TRACK_GAIN": "nan"}) == {}


def test_ignores_a_value_that_is_not_a_string():
    assert gain_tags({"replaygain_track_gain": None}) == {}
    assert gain_tags({"replaygain_track_gain": -6.54}) == {}


def test_reports_gain_and_peak_together():
    parsed = gain_tags({"replaygain_track_gain": "-6.54 dB", "replaygain_track_peak": "0.988"})

    assert parsed == {"tagGainDb": -6.54, "tagReferenceLufs": REPLAYGAIN_REFERENCE_LUFS, "tagPeakDb": -0.1}


def test_reports_a_peak_even_where_the_gain_is_missing():
    # They are separate tags and one can be written without the other.
    assert gain_tags({"replaygain_track_peak": "1.0"}) == {"tagPeakDb": 0.0}
