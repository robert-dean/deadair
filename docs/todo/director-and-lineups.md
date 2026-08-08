# Deferred: the music director and lineups

**Designed:** 2026-08-07, while planning the music director
**Status:** deferred, not disputed. Each item has a known landing place.

Cut from the director plan to keep the first pass on one thing: getting a lineup on air. See
[multi-station.md](multi-station.md) for the other deferred half.

## Segments in a lineup

Talk breaks, news bulletins, ads, idents. A lineup item is a track only, for now. A segment arm
(`kind: 'segment'`, `segmentKind`, a render state of `planned | rendering | ready | failed`, and the
audio once ready) needs no migration when it lands, because `lineups.items` is jsonb.

The rule that goes with it: the director SKIPS a segment that is not `ready` when the cursor reaches
it, so the station never stalls waiting on a renderer.

## A DJ that talks

An LLM writing breaks and a TTS rendering them. The seam is already there: `SetGenerator.generate`
takes and returns *named* picks (title + artist strings), which is what a model can produce, so an
LLM selector is a second binding rather than a reshape. Break rendering is the same shape as the
extend job: a job fills in a planned segment and moves it to `ready`.

## Live provider search when resolving a pick

The resolver is catalog-only at first. A pick resolves to a canonical track and its best
`track_sources` binding, or it is dropped. The deferred rung is a `searchTracks` fan-out across
catalog-capable plugins with a title/artist/duration scorer, for picks the catalog has never seen.
It matters for an LLM DJ naming songs the library does not hold; it does not matter while picks come
from the catalog itself.

## The daypart schedule

Morning / afternoon / evening / night, each naming a lineup. The director already re-reads
`deadair.station_air` on every wake and switches when it names a different lineup, which is the
behaviour a scheduler needs. What is deferred is the `Programme` seam (`current(): { slot, lineupId }`)
and the changeover policy: finish the track, then swap.

## The station's own permission surface

Routes use `platform.view` / `platform.manage` for now. Deferred: a `station` namespace in
`core.perm` with `view` / `request` / `program`, so an invited listener can be granted the right to
request a track without being handed operator control. `station:request` deliberately belongs to no
default role; it is a per-actor tuple.

## Plugins that programme the station

A `programme` manifest capability and a `host.station` surface (`nowPlaying`, `upcoming`, `request`,
`insert`, `remove`), gated by an operator-approved grant with `request` / `insert` / `urgent` flags.

The breaking-news case: a plugin declares `stream` too and its bulletin is fetched through the
existing `resolveStreamUrl`, so no bytes cross the plugin boundary. `position: 'now'` is the only
part needing new transport, namely `Rundown.insertNext`, which retracts the served-but-not-airing
tail so the bulletin airs next rather than five tracks later. `station_air.resume_lineup_id` and
`resume_cursor` already exist for handing the station back afterwards.

## Push destinations

TuneIn AIR, a scrobbler, a Discord presence. Nothing pushes today; a consumer polls `GET /nowplaying`
and the mount carries ICY. When one is genuinely wanted it is a plugin declaring a `nowplaying`
capability, fed by a `station.aired` event on `@maroonedsoftware/eventbus` (already a dependency,
still unused).

Note the bus is synchronous and fail-fast, so the director's own top-up must stay on
`Rundown.onAired` directly and never behind it.

## Rotation rules as operator settings

Constants in code for now. Deferred: `director.*` keys in `deadair.settings` resolved the way
`stream.settings.ts` does (repeat window, artist cooldown, per-artist cap, auto-extend, commit lead,
source preference), with a lineup's own `rules` jsonb overriding them field by field. The schema
column exists already.

## Palette steering

Distilling genres and year bands from enrichment to bias selection. The rotation rules land without
it; it is a weighting refinement, not a correctness one.

## The station console page

A lineup picker, the list with cover art and the cursor drawn as a line, per-row remove and move, and
Shuffle / Extend / Import / Put on air controls. Until then the existing transport bar shows what is
on air and what is next, and the API is drivable directly.
