# Crossfades between rundown items

**Written:** 2026-08-09, while adding a bus limiter and a voice chain to `stream/radio.liq`.
**State of the tree:** items butt up against each other. There is no `cross` anywhere in the graph.

This is the largest single audio-quality gap the station has. It is deferred not because it is hard
to write — the operator is four lines — but because of what it does to the one measurement the
station's timing is built on.

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
map, and adding a `liq_cross_duration` key there is the whole app-side change. The rundown item
already knows its own duration, so a short ident and a five-minute album track can carry different
blends without a second mechanism.

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

1. Subtracting the cross duration from the cue's due time, per item, since the duration is per item.
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
