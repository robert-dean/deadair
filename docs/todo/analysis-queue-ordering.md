# Which tracks the analyzer measures, and in what order

**Written:** 2026-08-11, from the question "does it make sense to only run the analyzer on tracks
that have been handed over or cached, so it does not fail on tracks we cannot retrieve?"
**State of the tree, 2026-08-11:** the walk is `AnalysisJob` → `AnalysisService.analysePending` →
`AnalysisRepository.listTracksNeedingAnalysis`, five tracks a run, one a minute, ordered
`t.created_at asc`. Nothing in it knows what the station has actually played.

The question is the right one and its premise is worth taking apart, because two of the three things
it assumes are not true of this tree and the third is true of something the walk does not do yet.

> **Update, 2026-08-12: there is a cache now, and half of "the version where analysis is free" is
> real.** `deadair.track_audio` keeps a copy of every record the station plays (`playout.trackCache`,
> on by default), and `AnalysisService.resolveAudio` asks `CachedTrackResolver` before the provider.
> So for anything the station has aired, a measurement is a local read and costs no provider fetch at
> all — `BATCH_SIZE` and `TRACK_PACE_MS` still bound the walk, but they are only spending anything on
> records that have never been played. The premise below that "there is no cache to ride on" is
> therefore out of date, and so is the reasoning that follows from it.
>
> What is NOT done, and is still worth its section: the walk does not order by `play_history`, so
> which tracks it reaches is unchanged; `unfetchable` and `undecodable` still land in one row with one
> suppression; nothing feeds an air-time failure back into `track_sources.missing_at`; and the walk
> deliberately does not FILL the cache, so a record the station has never played is fetched from the
> provider exactly as before. The fill is on air only, on purpose — measuring is not a reason to put a
> catalogue on disk.
>
> **Update, 2026-08-12 (later the same day): the distinction the section below is built on is gone.**
> The transport was reshaped so the player fetches every record from `/playout/audio/{sourceId}` and
> `TrackAudioService` is the only thing that ever asks a provider, which means the walk no longer tells
> a cached record from an uncached one at all: it resolves the same URL for both and the fetch behind
> that URL happens if it needs to. So "measure only what we have already got" is not a choice anyone
> can make any more, and it does not need to be — measuring a record the station has never played
> fetches it once, and with `playout.trackCache` on that fetch is also the copy the play will use.
>
> What that leaves genuinely open is only the ORDER of the walk (`play_history` rather than
> `created_at`), telling `unfetchable` from `undecodable`, and the `missing_at` feedback loop. The
> earlier hope of a tee is moot: nothing is teed, and nothing needs to be, because there is exactly one
> fetch per record rather than two.

## What "handed over or cached" would and would not buy

**There is no cache to ride on.** The shim streams a record on demand and Liquidsoap downloads each
queued item into its own request queue ahead of air and discards it; nothing is retained on disk
(`stream/spotify-shim/README.md`). So measuring a track the station played an hour ago costs exactly
the same full download as measuring one it has never played. Restricting the queue changes WHICH
tracks are measured, not what a measurement costs, and the cost is the whole reason `BATCH_SIZE` is
five.

**A handover proves less than it looks.** It proves a URL resolved at that moment. The URL is minted
per fetch and the audio key behind it is fetched per fetch, so a track that handed over cleanly last
week can still fail the analyzer today. The failure class a gate WOULD remove is narrower than "we
cannot retrieve it": a resolve that returns nothing is already not recorded as a failure
(`AnalysisService.measureOne`, and the comment there says why), so what is left is the case where the
URL resolves and the bytes never arrive. That one burns a full invocation and then suppresses the
track for `ANALYSIS_RETRY_AFTER_MS`, a day.

**A hard gate inverts the timing.** Both consumers that exist read the measurement AT handover:
`playout/gain.ts` decides the per-record level and `annotate.ts` stamps `liq_cue_in` / `liq_cue_out`.
The crossfade work in [crossfades.md](crossfades.md) wants cue points for the item ABOUT to air.
A track that can only be measured after it has aired is a track whose first play is permanently
unmeasured, and on a station that plays a long tail, "first play" is a large share of all plays.

So: order the queue by what the station plays, do not gate on it.

## The three changes, cheapest first

**1. Prefer tracks the station has actually aired.** `listTracksNeedingAnalysis` orders
`t.created_at asc` today, which is deterministic and nothing else. `deadair.play_history` is the
station's own record of what retrieved and played, so ordering by the most recent play first puts
each batch of five on records that demonstrably fetched and that the rotation is going to ask for
again, while leaving everything else in the queue behind them rather than out of it. This is an
`order by` and an index: `play_history` carries indexes on `aired_at`, `song_key` and `artist_key`,
and none on `track_id`, which this needs.

**2. Or measure on the played edge**, enqueueing the track that just aired if it is unmeasured or
stale. Same effect as (1) with the proof minutes old rather than days, and it makes the periodic walk
the backfill rather than the mechanism. It is more moving parts: the pacing in
`AnalysisService.TRACK_PACE_MS` exists so background fetches do not compete with the station's own,
and an edge-triggered measurement is by definition firing while the station is fetching the next
record. It should post work onto the same paced walk rather than measuring inline.

**3. Tell an unfetchable track apart from an undecodable one.** `analysis/app.py` already classifies
its own failures (`unfetchable` vs `undecodable` vs `truncated`) and `analyzer.plugin.ts` carries the
code into the error message, so the distinction survives all the way into
`track_analysis.failure_reason` as prose and is then thrown away: `recordFailure` gives both the same
row and the same day-long suppression. They deserve different treatment, and the reason is that they
are facts about different things. Undecodable is a property of the FILE and the long suppression is
right. Unfetchable is a property of the BINDING, and the row it belongs in is
`deadair.track_sources`.

Which surfaces something the tree is missing independently of analysis: **nothing feeds "could not
retrieve this at air time" back into `track_sources.missing_at`.** Its only writer is the catalog
resolver during ingest. Playout skipping an item it could not resolve, and the analyzer being handed
a URL that serves nothing, are both evidence about that binding, and both are currently forgotten.
Worth doing on its own terms; it also makes (1) sharper, because the walk already requires
`missing_at is null`.

## The version where analysis is free

Everything above is about spending the download well. The change that stops spending it twice is to
measure the bytes the station is ALREADY fetching: the shim serves a record to Liquidsoap ahead of
air, and those are the same bytes the sidecar wants. A tee from the shim to `POST /analyze`, or a
sidecar that reads what the shim wrote, removes the second fetch entirely and makes `BATCH_SIZE`
irrelevant, because measurement becomes a side effect of playing.

It is not a tweak. The shim streams rather than buffers (`stream/spotify-shim/README.md` is explicit
that no audio is committed to disk, which is what makes `/control/skip` land at once), so a tee means
deciding where the second copy goes and who cleans it up, and it only covers records the station
plays, so the walk still has to exist for everything else. Recorded here because it is the only
design in which the answer to "which tracks should we measure" is "all of them, eventually, for
nothing", and because anything built above should not make it harder.
