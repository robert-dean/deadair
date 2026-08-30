"""Vocal presence against synthetic signals.

Synthetic for `test_measure.py`'s reason, and the cases that matter here are
DISCRIMINATIONS rather than numbers: whether a held note and a syllabic line come
out on opposite sides, whether the band limit still holds, whether an
instrumental answers with no onset at all. What the threshold should be is not a
question this file can answer -- that is `apps/api/scripts/vocal.calibration.ts`,
against the real library, and `docs/todo/track-analysis.md` asks for it in as
many words.

    python3 -m pytest analysis/test_vocal.py
"""

from __future__ import annotations

import numpy as np

from loudness import to_downmix, to_mono
from measure import SAMPLE_RATE, band_envelope, hop_for, measure
from vocal import CURVE_MS, VOCAL_THRESHOLD, measure_vocals, presence_of

HOP = hop_for(SAMPLE_RATE)
RNG = np.random.default_rng(4321)


def _seconds(count: float) -> np.ndarray:
    return np.arange(int(count * SAMPLE_RATE), dtype=np.float64) / SAMPLE_RATE


def tone(seconds: float, freq: float = 900.0, amplitude: float = 0.4) -> np.ndarray:
    """A held note inside the vocal band. The thing that must NOT read as a voice."""
    return (amplitude * np.sin(2 * np.pi * freq * _seconds(seconds))).astype(np.float32)


def sung(seconds: float, freq: float = 900.0, syllables_per_second: float = 4.0, depth: float = 1.0) -> np.ndarray:
    """The same note, with its level moving at syllable rate. A stand-in for a line.

    Fully modulated by default, which is the clean end of what a real voice does:
    the point of the test is the SIDE of the threshold it lands on, not the value.
    """
    t = _seconds(seconds)
    envelope = 1.0 - depth * 0.5 * (1.0 + np.sin(2 * np.pi * syllables_per_second * t))
    return (0.4 * envelope * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def bass(seconds: float, amplitude: float = 0.5) -> np.ndarray:
    """Modulated at syllable rate, but BELOW the band. Must read as nothing."""
    t = _seconds(seconds)
    envelope = 1.0 - 0.5 * (1.0 + np.sin(2 * np.pi * 4.0 * t))
    return (amplitude * envelope * np.sin(2 * np.pi * 60.0 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def presence(signal: np.ndarray) -> np.ndarray:
    return presence_of(band_envelope(signal, HOP))


def vocals(signal: np.ndarray):
    """One record through the pair of folds `app.py` actually uses.

    The two folds are the point of routing it this way rather than passing one
    array twice: the cue points read `to_mono` and the vocals read `to_downmix`,
    and a test that fed both the same signal would pass while the service failed.
    """
    return measure_vocals(to_downmix(signal), measure(to_mono(signal), SAMPLE_RATE), SAMPLE_RATE)


def stereo(left: np.ndarray, right: np.ndarray | None = None) -> np.ndarray:
    """Two channels, slightly different, as a real record's are."""
    other = left if right is None else right
    return np.stack([left, other], axis=1)


# ── the discrimination this file exists for ───────────────────────────────────


def test_a_held_note_reads_as_no_voice():
    # The failure the whole design is against: a plain band envelope cannot tell
    # this from a sung line, because both are energy in 200 Hz-4 kHz.
    assert float(np.median(presence(tone(8.0)))) < VOCAL_THRESHOLD


def test_a_syllabic_line_reads_as_a_voice():
    assert float(np.median(presence(sung(8.0)))) >= VOCAL_THRESHOLD


def test_the_two_are_separated_by_a_wide_margin():
    # Not just on opposite sides of one number -- far enough apart that the
    # threshold has somewhere to be calibrated TO. A gap this test can measure is
    # the room `vocal.calibration.ts` gets to work in.
    held = float(np.median(presence(tone(8.0))))
    line = float(np.median(presence(sung(8.0))))

    assert line - held > 0.15


def test_modulation_below_the_band_is_not_a_voice():
    # `BAND_HZ`'s guard, from the other side: this is modulated at exactly
    # syllable rate and is bass, so a detector that skipped the band-pass would
    # call a throbbing bassline a vocal on every dance record in the library.
    #
    # **This caught a live bug and is the reason ABSOLUTE_FLOOR exists.** The
    # band-pass does attenuate it -- to -96.6 dBFS -- and that was not enough,
    # because presence is a RATIO and the leakage was being divided by itself. It
    # read 0.61, a confident vocal. A relative floor cannot catch it either, since
    # a track made of leakage sets its own reference from the leakage.
    assert float(np.median(presence(bass(8.0)))) < VOCAL_THRESHOLD


def test_modulation_slower_than_speech_is_not_a_voice():
    # A chord changing every two seconds, which every instrument does. Below
    # SYLLABIC_HZ's lower edge, and that edge is the load-bearing one.
    assert float(np.median(presence(sung(12.0, syllables_per_second=0.5)))) < VOCAL_THRESHOLD


# ── the onset ─────────────────────────────────────────────────────────────────


def test_finds_the_onset_after_an_instrumental_opening():
    # Eight seconds of held note, then singing. The number worth having: the gap
    # between "the record is underway" and "the singing starts" is exactly the
    # talk-up time this measurement exists to find.
    result = vocals(np.concatenate([tone(8.0), sung(8.0)]))

    assert result.onset is not None
    assert 7_000 <= result.onset <= 10_500


def test_an_instrumental_reports_no_onset_at_all():
    # Not a fallback to `cue_in` or `intro_end`: both are numbers the consumer
    # already holds, and answering with one would claim a vocal was found.
    assert vocals(tone(12.0)).onset is None


def test_silence_reports_no_onset():
    assert vocals(silence(4.0)).onset is None


def test_a_single_word_is_not_the_vocal_starting():
    # A shout over an instrumental opening, well under VOCAL_SUSTAIN_MS. The
    # sustain requirement is what `_first_sustained` applies one layer down, for
    # the same reason.
    #
    # **This caught the second live bug and is why VOCAL_SUSTAIN_MS is twice
    # LEVEL_WINDOW_MS.** At equal lengths it returned an onset for this 0.4s
    # burst: the moving RMS smears a burst across a window either side of itself,
    # so the burst manufactured the very run the sustain check was looking for. A
    # sustain requirement has to outlast the smoothing that feeds it.
    result = vocals(np.concatenate([tone(6.0), sung(0.4), tone(6.0)]))

    assert result.onset is None


def test_the_onset_lands_inside_the_sounding_region():
    # Leading silence is not somewhere a vocal can start, and every consumer
    # seeks with this number.
    result = vocals(np.concatenate([silence(2.0), sung(10.0)]))

    assert result.onset is not None
    assert result.onset >= 2_000


# ── the curve ─────────────────────────────────────────────────────────────────


def test_the_curve_is_always_produced_even_for_an_instrumental():
    # The whole of how a reader tells "looked, found nothing" from "never
    # looked", and in `listTracksNeedingAnalysis` it is also what marks a row as
    # predating this layer. An instrumental has a curve and no onset.
    result = vocals(tone(6.0))

    assert result.onset is None
    assert len(result.curve) > 0
    assert all(0 <= value <= 100 for value in result.curve)


def test_the_curve_covers_the_whole_file_at_its_stated_resolution():
    # Indices are file time. A reader multiplies by CURVE_MS and gets an offset,
    # with no second number to hold.
    result = vocals(np.concatenate([silence(1.0), sung(5.0)]))

    assert len(result.curve) == round(6_000 / CURVE_MS)


def test_the_curve_is_high_where_the_singing_is_and_low_before_it():
    result = vocals(np.concatenate([tone(8.0), sung(8.0)]))
    per_second = round(1_000 / CURVE_MS)
    # The middle of each half, so neither sample sits on the join.
    instrumental = result.curve[4 * per_second]
    singing = result.curve[12 * per_second]

    assert singing > instrumental


def test_the_wire_shape_omits_an_absent_onset_rather_than_nulling_it():
    # `undefined` means not set, everywhere. A null would be a third state for
    # every consumer to learn.
    assert "vocalOnset" not in vocals(tone(6.0)).as_data()
    assert "vocalCurve" in vocals(tone(6.0)).as_data()


def test_a_clip_too_short_to_measure_answers_rather_than_raising():
    # An unmeasurable track still has to play, which is the rule the whole
    # measurement path is held to.
    result = vocals(tone(0.05))

    assert result.onset is None


# ── stereo, which is where the third live bug was ─────────────────────────────


def test_a_stereo_bassline_is_still_not_a_voice():
    # **The third bug this file caught, and the worst of them**, because it would
    # have fired on most of a real library rather than on an edge case.
    #
    # `to_mono` folds channels as sqrt(mean(x^2)), which is an energy envelope and
    # therefore RECTIFIES. A band-pass over it reads harmonics that rectification
    # invented: measured, this bassline arrives inside 200 Hz-4 kHz at -32.5 dBFS
    # where the waveform itself is at -96.6. Every stereo record with a bassline
    # read as singing from the first bar.
    #
    # The fix is that vocals read `to_downmix` and the cue points keep `to_mono`.
    # A test that folded once could not see this, which is why `vocals()` above
    # does both folds the way `app.py` does.
    left = bass(10.0)
    right = (bass(10.0) * 0.9).astype(np.float32)

    assert vocals(stereo(left, right)).onset is None


def test_a_stereo_vocal_is_still_a_voice():
    # The other side of the same change: the fold that fixed the bassline must not
    # have cost the detection it exists for.
    line = sung(10.0)
    other = (sung(10.0) * 0.95).astype(np.float32)

    result = vocals(stereo(np.concatenate([tone(4.0), line]), np.concatenate([tone(4.0), other])))

    assert result.onset is not None


def test_a_mono_file_and_a_stereo_one_agree_about_the_same_record():
    # `to_downmix` returns the waveform untouched for a single channel and
    # averages above that, so the same record does not measure differently for
    # having been delivered with two identical channels. `to_mono` does not have
    # this property, which is half of why the vocals do not use it.
    signal = np.concatenate([tone(4.0), sung(10.0)])

    mono_onset = vocals(signal).onset
    stereo_onset = vocals(stereo(signal)).onset

    assert mono_onset is not None and stereo_onset is not None
    assert abs(mono_onset - stereo_onset) <= CURVE_MS
