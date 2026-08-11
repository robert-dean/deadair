# Crossfades between rundown items

**Written:** 2026-08-09, while adding a bus limiter and a voice chain to `stream/radio.liq`.
**Revised:** 2026-08-09, when the near-term goal became a station the operator listens to all day.
**Revised:** 2026-08-10, with where the blend length comes from, which is a measurement of both
records rather than a setting.
**State of the tree:** items butt up against each other. There is no `cross` anywhere in the graph.

This is the largest single audio-quality gap the station has. It is deferred not because it is hard
to write — the operator is four lines — but because of what it does to the one measurement the
station's timing is built on.

**It is no longer a someday.** Measured against a full working day of listening rather than against
a feature list, this is second only to the station being able to talk: a gap between records is heard
every three minutes for eight hours, where most of what is deferred elsewhere is heard once. See
[dj-voice.md](dj-voice.md), "The order, restated against daily listening". It stays second rather
than first for the reason immediately below, which is unchanged: it moves the clock the DJ breaks are
timed against, so it wants those breaks landing reliably first.

**It has one genuine prerequisite**, added 2026-08-10: the per-track measurement in
[station-intelligence.md](station-intelligence.md) §3, because without it there is no honest number
to blend for. A fixed duration is not a smaller version of this feature, it is the thing that makes
transitions sound wrong on most pairs, which is the problem being solved. Where that measurement
comes from is [track-analysis.md](track-analysis.md), added 2026-08-11, along with the beat layer
that "What the blend does inside the buffer" below needs on top of the four cue points.

---

## The seam

A `cross` between `playout_bed` and the `bed` fallback in `radio.liq`:

```liquidsoap
playout_bed = normalize(target=-16., playout_queue)
playout_bed = cross(duration=…, persist_override=true, transition, playout_bed)
bed = fallback(track_sensitive=false, [playout_bed, music, station_id])
```

Per-item durations ride the `annotate:` metadata that already exists: `itemAnnotations` in
[apps/api/src/modules/playout/annotate.ts](../../apps/api/src/modules/playout/annotate.ts) builds the
map, and adding a `liq_cross_duration` key there is the whole app-side change.

## Where the length comes from

Not from a setting, and not from the item's own duration. A blend is a property of the PAIR, and the
input is a measurement of both records. See
[station-intelligence.md](station-intelligence.md), "Measure four points, not one classification":
each track carries `cue_in`, `intro_end`, `outro_start` and `cue_out`, from which

```
buffer = min(outgoing.outro, incoming.intro)
```

A record that ends cold has a short outro and is barely ridden. One that fades has a long one and is
ridden for as long as the next record's intro can absorb it, never longer, so a blend can never eat a
cold opening. There is no constant to tune and no operator knob to get wrong.

Two consequences for this file specifically:

- **The stamp is a property of the boundary, not of the item.** `liq_cross_duration` is stamped on
  the OUTGOING item, but its value depends on the incoming one, so the pusher can only compute it
  once it knows what follows. That is fine — the pusher hands items over in order and already knows
  the running order — but it means the annotation cannot be built from an item in isolation, which
  is how `itemAnnotations` reads today.
- **The last item handed over has no successor yet.** Stamp it with its own outro length as the
  ceiling and restamp is not possible, so either accept the ceiling or hold the stamp until the next
  item is chosen. Neither is hard; deciding which before writing it saves a rewrite.

**A cheaper thing lives at the same seam.** `liq_cue_in` and `liq_cue_out` are already annotate keys,
and trimming the dead air off the head and tail of each record needs no `cross`, no pair logic, and
none of the clock work below. If the measurement pass lands before this one does, that trim is worth
shipping on its own.

## What the blend does inside the buffer

**Added 2026-08-11.** Everything above decides how LONG the overlap is. This decides what happens
during it, and it is a separate question with a separate answer. It needs the beat layer in
[track-analysis.md](track-analysis.md) rather than only the four cue points, so it sits behind that
file, and it is worth reading before building the simple version because the simple version is the
bottom rung of the ladder below rather than a different design.

### A ladder gated on evidence, not on preference

The station should attempt the most ambitious transition the measurement supports and no more.
Three rungs, checked most-disqualifying first:

| Rung | What it does | Gate |
| --- | --- | --- |
| Plain fade | equal-power blend over the buffer | anything below, or no analysis at all |
| Filtered handover | quantised anchors, filter sweep, bass handover | tempo ratio within about 4% after octave normalisation, and at least one side confident |
| Beat-matched | the above, plus a tempo nudge to lock the grids | both sides confidently measured |

The numbers that work, from an implementation running against real libraries: a tempo outside
40–220 BPM disqualifies outright, beat confidence below about 0.2 on both sides drops to a plain
fade, and below about 0.55 on either side blocks beat-matching while still permitting the filtered
handover. Treat them as starting points rather than as findings, but keep the shape, because the
shape is the part that matters: **missing evidence degrades to a defined behaviour instead of being
guessed at**, and a tempo from metadata alone can never authorise beat-matching. That last rule is
why [track-analysis.md](track-analysis.md) stores provenance beside the value.

Two mechanics that are not obvious and are cheap once known:

- **Normalise tempo into one octave before comparing.** A 63 BPM record against a 126 BPM one is a
  match, counted the way a DJ counts it, and a naive ratio calls it a mismatch and drops a rung for
  no reason.
- **The tempo nudge is a time-stretch, not a resample.** Stretching without shifting pitch, inside
  the overlap only, is a beat-match. Changing playback rate is a detune, and it is audible on
  anything with a sustained note.

### Quantise the anchor, do not just fade at a time

A blend that starts at an arbitrary instant sounds like a blend. One that starts on a bar line
sounds intentional. Snap the transition point to the nearest phrase boundary within about four
beats, failing that to the nearest downbeat within about two, failing both use the raw time. The
tolerances are what stop quantisation from dragging the anchor somewhere musically worse than where
it started.

### Three moves on the outgoing track, and one of them is not a fade

For the filtered handover, the useful part is spectral rather than level:

- **A low-pass sweep on the outgoing track**, exponential in frequency, ending near the bass
  crossover. The record thins out and recedes rather than merely getting quieter.
- **A mid-band duck**, up to about 6 dB, scaled by the incoming track's own power, so the two do not
  compete where voices and guitars live.
- **A bass handover that switches once**, roughly 40% through the overlap, rather than crossfading.
  Two basslines summing is the classic mud, and this is the single cheapest fix for it. It is also
  the one move here that a level-only crossfade cannot approximate at all.

All three are engine work in `radio.liq`, not app work, and they need the filter chain to be per
transition rather than on the bus.

### What this does to the length rule

`buffer = min(outgoing.outro, incoming.intro)` stays the rule for the plain rung. The other two
rungs want a length in BEATS rather than seconds, because the whole point is that the overlap lines
up with the music: roughly 8 beats for a compatible pair, 16 when the keys are distant or both sides
are singing, converted to seconds at the matched tempo and then clamped into the same 4–12 second
window the measurement produces. The clamp is what keeps the two rules from disagreeing, and the
`min()` above remains the ceiling in every case, so a blend still cannot eat a cold opening.

## Why it is deferred: the cross buffer moves the clock

`cross` holds `duration` seconds of audio to blend across the boundary. The boundary itself — the
`on_track` hook on `playout_queue`, which sits *below* the cross — fires when the decoder crosses
over, not when the listener hears it. So `on_air_elapsed`, reset in that hook, runs ahead of the
audience by up to the cross duration.

Every DJ break is timed against that counter. `voice_cue_check` fires a cue when
`on_air_elapsed() >= voice_at_s() - duck_fade_ms/1000`, and the reason that is exact today is that
nothing between the boundary and the encoder delays one source relative to the other: the voice and
the bed are mixed pre-encoder, so whatever buffering separates the decoder from the listener applies
to both and cancels. A cross breaks that symmetry, because it delays the bed and not the voice.

Landing crossfades therefore means:

1. Subtracting the cross duration from the cue's due time, per boundary, since by the section above
   the duration is decided per pair rather than per item and is not a constant anywhere.
2. Deciding what happens to a cue armed against a record whose blend is still running — the outgoing
   and incoming tracks are both audible, and `on_air_item()` has already moved on.
3. Re-verifying break placement on air by ear, because there is no test that can hear it.

None of that is unreasonable. It is simply a change to the part of the system that currently has no
error in it, and it should be its own pass rather than a rider on somebody else's.

## Engine constraints, so they are not rediscovered

Measured against Liquidsoap 2.4.x, which is what `stream/Dockerfile` pins:

- **The low-level `cross`, not the `crossfade` wrapper.** `crossfade(smart=false)` silently routes
  through its own internal simple transition and ignores a custom callback entirely, so a transition
  function passed to it appears to do nothing and there is no error to explain why.
- **`persist_override=true` is required on 2.4.** Without it the `liq_cross_duration` override is
  reset before it sizes the stamped track's own end-of-track buffer, so a per-item duration is
  accepted and then not used. The flip side is that a stamp lingers over later unstamped tracks, so
  every pushed item has to carry one — which for us is automatic, since every item goes through
  `itemAnnotations`.
- **The fade must span the ENTIRE cross buffer.** A fade shorter than the buffer leaves the outgoing
  track at full level while the incoming ramps in, which sums to about +6 dB and is audible as a
  lurch on every transition. To vary the blend, vary the buffer, never the fade inside it.
- **`cross` presents its output as one never-ending track.** Anything `track_sensitive` placed above
  it never sees another boundary. Our lease gate and bed fallback are both
  `track_sensitive=false` already, so they are unaffected, but this is the trap for anything added
  above the cross later.

## Related, and also not built

**Retracting one queued item by request id.** `/control/push` already answers with the `rid`
Liquidsoap assigned, and `drop_queued` in `radio.liq` already does per-request removal — so a
`/control/unpush` taking a single rid is a small addition. It is not built because nothing in the app
wants it: the only retraction today is "drop the whole running order", which `/control/flush` does.
A caller would appear if the director ever edited a lineup that was already partly handed over.
