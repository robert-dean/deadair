# Where per-track measurement comes from

**Written:** 2026-08-11, after reading how working desktop players do beat-aware transitions and
finding that the interesting half of it is not the transition.
**State of the tree:** nothing measures a track. No table, no job, no plugin.

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

`vocal_curve` can be coarse. A value every half second over a band of roughly 200 Hz to 4 kHz is
enough for both uses, and storing it at audio frame rate would be storing a signal to make one
decision from.

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

**The licence check comes before the design, not after.** The toolkits that compute beat grids and
vocal separation are mostly copyleft, several AGPL, and §3 already flags this. It bears on the
choice above rather than merely on the code: a sidecar is a separate program communicating over
HTTP, which is a materially different licence position from linking the same library into the API
process. If option 1 is chosen for licence reasons rather than architectural ones, write that down,
because it is the kind of decision that gets "simplified" later by someone who only sees the
container.

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
