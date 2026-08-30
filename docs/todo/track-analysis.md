# Where per-track measurement comes from

**Written:** 2026-08-11, after reading how working desktop players do beat-aware transitions and
finding that the interesting half of it is not the transition.
**State of the tree, 2026-08-11:** option 1 below is BUILT, and this file is now half a record of
what landed. `analysis/` is a Python sidecar answering `GET /health` and `POST /analyze` over HTTP,
`plugins/analyzer/` is the adapter, `analysis` is a capability of its own in the plugin SDK rather
than a kind of enrichment (`packages/plugin-sdk/src/capabilities/analysis.ts` says why), and
`deadair.track_analysis` in migration `0005_music.sql` is the row, carrying a schema version and a
completeness flag exactly as "The storage shape" below asks for. `AnalysisModule` in `apps/api`
walks the catalog and measures what it finds. The four cue points come from an RMS envelope over
ffmpeg-decoded samples, and the loudness layer at the end is built and checked against `ebur128`.

**What is still deferred is the beat layer alone** — `bpm`, `beat_confidence`, `downbeats`,
`vocal_onset`, `vocal_curve`. **Its licence question is now answered** in
[../decisions/analysis-licensing.md](../decisions/analysis-licensing.md), and the answer changes two
things this file says below. Every dependency in the analysis path is permissive, weights included,
so no copyleft toolkit is a candidate at all. And the sidecar was NOT chosen for licence reasons: it
was chosen because decoding does not happen in Node, which is the whole of it. Read that file before
pinning anything, and read it instead of "The licence check comes before the design" below, which it
supersedes.

**`vocal_onset` was built on 2026-08-30 and REVERTED the same day, and the negative result is the
most useful thing in this file.** It is written up under "The vocal fields cannot be measured this
way" below. Read it before reaching for those two fields again: the cheap approach does not work,
and the reason is not the one anybody would guess.

Three deferred features now depend on measured audio, and each of them was scoped assuming its own
answer to where the numbers come from. They should share one:

- [station-intelligence.md](station-intelligence.md) §3, the four cue points, which is the oldest of
  the three and already says the analysis is an enrichment plugin.
- [crossfades.md](crossfades.md), "What the blend does inside the buffer", which needs a beat grid
  and a tempo confidence on top of those four points.
- [dj-voice.md](dj-voice.md), the talk-up limit, which wants a vocal-onset time that the four points
  approximate and do not measure.

This file is the shared dependency, not a fourth feature. **Nothing here is worth building on its
own**; it is worth building once, before the first of the three, so the second and third do not each
grow their own.

---

## What has to be measured

The four points in station-intelligence §3 stand unchanged (`cue_in`, `intro_end`, `outro_start`,
`cue_out`, all absolute offsets into the file). What the transition work adds is a second layer:

| Field | What it is | Who needs it |
| --- | --- | --- |
| `bpm` | tempo, octave-ambiguous and stored as measured | the blend policy ladder |
| `beat_confidence` | 0–1, how much the tempo is to be trusted | the ladder, decisively |
| `downbeats` | positions of bar ones, so an anchor can be quantised | phrase and downbeat snapping |
| `vocal_onset` | first sustained vocal after `cue_in` | the talk-up limit |
| `vocal_curve` | vocal presence over time, coarse | filter depth during a blend, and outro talk |

**`beat_confidence` is the load-bearing one**, and it is the field a naive implementation omits. The
whole point of the policy ladder is that it refuses to beat-match on weak evidence, and a tempo
figure with no confidence attached cannot express weak. A measured BPM and a metadata BPM are also
different claims and should not be stored in one column: the rule the ladder enforces is that
metadata alone never authorises beat-matching, which is unstateable if the provenance is lost on
write.

**Two guards from a comparable station's worst bugs in this exact layer, added 2026-08-28.** Both are
the naive implementation rather than bad luck, and both are cheap to hold and expensive to retrofit:

- **The confidence has to be WRONG-TEMPO-AWARE, not merely present.** A tempo detector run without
  octave correction reports double-time on slow material *and* scores the wrong tempo as fully
  plausible. A number that says "this is definitely 140" when the record is 70 is worse than no
  number at all, because the ladder above is built to trust it. The row for `bpm` says
  octave-ambiguous; this is the same fact asked of the field beside it.
- **A vocal detector at its default threshold produced enough false positives to break the cue points
  that depended on it.** `vocal_onset` feeds the talk-up limit, so a false early onset is a station
  that stops talking before the singing starts — which reads as a bug in the talk-up rule and is not
  one. Whatever threshold this ships with is a measured number on this library, not a default.

**One operational note for the sidecar, same layer.** A long-running Python process that decodes
whole records accumulates resident memory the allocator does not return, independent of any leak in
the code — their analysis worker grew unbounded over long uptime for exactly this reason. `analysis/`
has the same shape and has never been watched for it. The cheap answers (trim thresholds, or
recycling the worker every N records) are worth having in hand before the beat layer makes each
measurement more expensive, rather than diagnosed afterwards.

`vocal_curve` can be coarse. A value every half second over a band of roughly 200 Hz to 4 kHz is
enough for both uses, and storing it at audio frame rate would be storing a signal to make one
decision from.

## The vocal fields cannot be measured this way

**Built and reverted 2026-08-30.** `analysis-licensing.md` puts `vocal_onset` and `vocal_curve`
outside the licence question — "two of the five are not part of the problem at all", computed from
"band-limited energy, 200 Hz to 4 kHz". That is correct about licensing and wrong about
feasibility, and the difference cost a day.

**Band energy alone measures nothing new**, which was caught at design time: 200 Hz–4 kHz is the
band `intro_end` already uses, because it is where voices *and lead instruments* live. The
replacement was the standard speech/music discriminator — a voice is SYLLABIC, so measure the
envelope's own modulation at 2–8 Hz against the level it is modulating. Pure `scipy.signal`, no
model, no weights.

**It works on synthetic signals and carries no vocal information on real music.** Measured through
the sidecar against this library:

| record | vocal enters | presence before | after | step |
| --- | --- | --- | --- | --- |
| Rush — YYZ | never (instrumental) | 19.5 | 14.9 | −4.6 |
| Kansas — Dust in the Wind | 0:22 | 12.0 | 14.9 | **+2.9** |
| Rolling Stones — Gimme Shelter | 0:35 | 20.5 | 18.4 | −2.0 |
| AC/DC — Highway to Hell | 0:11 | 22.9 | 19.3 | −3.6 |
| Black Sabbath — Paranoid | 0:12 | 13.7 | 18.2 | **+4.6** |

The steps are ±5 with a sign unrelated to the truth, and the instrumental's own drift (−4.6) is as
large as any of them. Across twelve records the presence distribution was p50 17, p90 44 with no
bimodality for a threshold to cut, three of seven onsets landed on `cue_in`, and **YYZ — an
instrumental — was given an onset at 0:00.** A refinement contrasting the vocal band against a
60–160 Hz band (drums move both, a voice moves only the mid) collapsed to zero almost everywhere.

**The reason, which is the part to keep:** syllabic-rate modulation in the vocal band is not
specific to voice in rhythmic popular music, because drums, rhythm guitar and arpeggios all modulate
at 2–8 Hz. The synthetic negative control was a *held tone*, and no real instrumental is a held
tone — so the tests passed while the feature did not work. **A detector whose negative case is
easier than reality is a detector that ships.**

Three things worth having from it:

- **The calibration pass is what caught it**, exactly as the guard below asks. It was worth building
  before the threshold was pinned rather than after, and a walk that had swept the library first
  would have written 762 confident wrong rows.
- **`to_mono` rectifies**, which is now documented in `loudness.py` and matters to anything spectral
  the beat layer adds. Folding as `sqrt(mean(x²))` lifted a 60 Hz bassline into the mid band by
  64 dB. The cue points are calibrated against that signal; a filter must not read it.
- **What would work is a model**, and the honest next step for this field is not another DSP
  attempt. [track-lyrics.md](track-lyrics.md) already argues the better route and needs no audio at
  all: a synced lyric's first timestamp is "a number somebody typed while listening". This result
  is an argument for that file.

## Where it runs, and the two constraints that decide it

§3 already says analysis is an enrichment plugin rather than app code, for good reasons that still
hold: it is a per-track fan-out over something slow or absent, which is what `EnrichmentModule` is,
and it needs bytes, which is `response.body` off `host.fetch`. Two things complicate that and neither
was known when it was written.

**The measurements need decoded PCM, and decoding is the thing this tree does not do.** Every field
above comes from samples, not from a container. An enrichment plugin holding a `ReadableStream` of
an encoded file has to decode it to measure anything, in the API process, which is the one place the
station's architecture says audio does not go. Three ways out, in order of preference:

1. **An analysis sidecar**, beside Liquidsoap where the decoders already are, exposed over HTTP and
   called by the enrichment plugin. Keeps the plugin seam intact, keeps decoding out of Node, and is
   the same shape as the track fetcher. It is a container, which is the cost.
2. **A one-shot decode subprocess** invoked by the plugin, which is a sidecar with worse lifecycle
   and no container.
3. **Decode in-process** and argue the exception. Cheapest to write, and it puts a CPU-bound decode
   loop inside the request path of the API server, so it is only defensible if analysis is strictly
   a background job with a concurrency of one.

**The licence check comes before the design, not after.** ~~The toolkits that compute beat grids and
vocal separation are mostly copyleft, several AGPL, and §3 already flags this. It bears on the choice
above rather than merely on the code: a sidecar is a separate program communicating over HTTP, which
is a materially different licence position from linking the same library into the API process.~~
**Superseded 2026-08-11 by [../decisions/analysis-licensing.md](../decisions/analysis-licensing.md),
which took this file up on its own request to write the answer down.** It came out the other way
round: the rule is that nothing copyleft or non-commercial enters the analysis path in the first
place, weights included, so the boundary never carries any licence weight and option 1 stands on
keeping the decoder out of Node alone. The paragraph above is kept because it is the reasoning the
decision had to answer, not because it holds.

## The storage shape

One row per track, keyed by the catalog's track id, with two fields that are not measurements and
are the difference between a cache that can be trusted and one that cannot:

- **A schema version.** Analysis output changes shape as detectors improve, and a row written by an
  older version has to be recognised as stale rather than read as missing or, worse, read as current.
  Load-time validation against the current version is what makes reanalysis automatic instead of a
  migration.
- **A completeness flag on the source audio.** §3 already makes this point about outros and it
  applies to every field here: a byte-capped or truncated download produces confident measurements of
  a file that was never the track. `PLUGIN_BODY_IDLE_TIMEOUT_MS`, `PLUGIN_BODY_LIFETIME_MS` and
  `PLUGIN_RESPONSE_MAX_BYTES` all bound a body independently of the fetch that returned it, so
  whatever fetches audio for analysis has to report whether it got all of it, and a truncation has to
  be told apart from a short track rather than measured.

Measurement is expensive and permanent, so it is written once and read forever, which makes the
staleness rules matter more than the write path.

## Loudness, which is the cheapest layer here and is not part of the beat one

**Added 2026-08-11**, after checking whether a commercial audio SDK was worth licensing for any of
this. It was not, for reasons that are not worth a file: it is a native library to link into a
process, and every place it could go is already occupied by Liquidsoap or by ffmpeg. The one thing
the survey turned up is that the loudness measurement the station has already specified is a few
lines away and nobody had noticed.

[station-intelligence.md](station-intelligence.md) §4 decides per-track gain and says to prefer the
file's own ReplayGain tags, then "fall back to a measured figure". **Nothing measures that figure.**
This is it, and it belongs here rather than in §4 because it comes off the same decode as everything
above:

| Field | What it is | Who needs it |
| --- | --- | --- |
| `lufs_integrated` | BS.1770 integrated loudness over the whole track | §4's gain, wherever no ReplayGain tag exists |
| `true_peak_dbtp` | true peak in dBTP, oversampled | §4's "respect peak headroom", which is otherwise a guess |
| `loudness_range_lu` | LRA, optional | nothing yet; it is free once the other two are measured |

`true_peak_dbtp` is the one that turns §4 from a policy into something enforceable. Capping a boost
so a quiet master is not lifted into clipping needs a number for how much headroom that master has,
and a sample peak is not that number.

This layer is worth calling out separately for two reasons. It **does not wait on the beat layer**,
so it does not inherit the copyleft question in the section above: it is a measurement ffmpeg already
implements. And it is the only field here with a consumer that is already designed, so it can ship
with the cue points rather than behind them.

### The trap: it cannot be measured from a mono downmix

**This section was written as a warning and then proved by breaking it.** Loudness was first measured
over the samples the cue points use, which at the time were mono. Both predicted failures happened,
measured against ffmpeg's own `ebur128`:

- **The downmix breaks the standard.** BS.1770 sums K-weighted power per channel; a mono downmix
  averages instead. Uncorrelated stereo read **−18.8 LUFS against a true −15.8**, and an anti-phase
  pair cancelled outright and produced **no reading at all**. Real music is partly correlated, so the
  error varies by record — worse than a constant one, because nothing about the number looks wrong.
- **True peak needs the native rate**, which is why the decode moved to 48 kHz. That also removed the
  second half of the problem: the rate BS.1770 publishes its coefficients at is the rate the decode
  now runs at, so nothing has to be re-derived.

### Where it actually went

**Built 2026-08-11.** `analysis/loudness.py`, a BS.1770 implementation over `scipy.signal`, on a
decode that keeps up to two channels at 48 kHz. `analysis/app.py` folds to mono for the cue points
alone, and that fold is energy-preserving (`sqrt(mean(x²))`) rather than an average, so anti-phase
content survives it.

Not ffmpeg's `ebur128` filter, which an earlier draft of this section proposed. Two reasons the
in-process implementation won, and the first is the one that decided it:

1. **The `-loglevel` wrinkle that draft identified is real and has no clean answer.** `ebur128`
   reports at INFO while the decode runs at `error`, and raising the level globally feeds a great
   deal more prose to the `_UNFETCHABLE` prose match — where a stream title containing `404` would
   newly misclassify an undecodable file as an unreachable one. Both escape routes (an `ametadata`
   sink, or a second `-f null -` pass that doubles decode time) cost more than the code does.
2. It made the measurement testable. The compliance sines, the gating cases and the channel-summing
   regression are all unit tests against arrays; a filtergraph would only have been testable end to
   end.

`ebur128` is still what the implementation is CHECKED against, which is the better use of it — see
`analysis/README.md`. The two agree to two decimal places on mono, correlated stereo, uncorrelated
stereo and anti-phase signals.

It cost scipy, against a `requirements.txt` that was four lines by deliberate choice. Worth it:
K-weighting is a two-stage biquad and pure numpy has no IIR, so the alternative was a Python loop
over fourteen million samples per track. scipy is BSD, so it changes nothing about the licence
position that puts this in a container.

The fields go in the opaque `data` blob under the existing `schemaVersion`, which is exactly the
extension that blob exists for: no change to the plugin, the host, or the database.

**Consumed 2026-08-11**, which is the half that was missing for a day: `playout/gain.ts` turns the
figures into one number per item, `annotate.ts` stamps it, `radio.liq` acts on it. See
[station-intelligence.md](station-intelligence.md) §4 for what that took, including the follower that
had to be demoted alongside it. The consumer being designed already is what let this ship ahead of
the beat layer, exactly as this section claimed.

### What it does not change

`radio.liq` keeps `normalize(target=-16.)` on its leaf sources, and `stream/README.md`'s rule that no
loudness normaliser, widener or bus compressor goes on the mix bus still stands. This is a static
number per item riding the `annotate:` uri the pusher already builds, decided before air, which is
§4's design and not a new one. It also does not remove the ReplayGain tag path: a tag the source
carries is still preferred, because it is what the mastering engineer or the label decided and a
measurement is what this station guessed.

## What this does not solve

**Nobody sells these numbers.** §3 checked this on 2026-08-10 for the four points and the answer is
the same for the beat layer: catalog upstreams return tempo, key and energy, none of them returns a
downbeat grid, a beat confidence or a vocal onset. The one large free corpus of computed descriptors
is a fixed 2022 dump, useful as a cold-start layer for back catalogue keyed by recording id and
nothing at all for recent releases. So this is measured locally or not at all, which is why the
sidecar question above is the whole question.

**Analysis cannot be a precondition for airing.** Whatever this becomes, an unanalysed track has to
play. Every consumer listed at the top degrades to a defined behaviour when the row is missing (plain
fade, no talk-up, original ordering), and that is a property to preserve deliberately rather than a
gap to close.
