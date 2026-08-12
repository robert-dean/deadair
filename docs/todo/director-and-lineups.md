# Deferred: the music director and lineups

**Designed:** 2026-08-07, while planning the music director
**Revised:** 2026-08-08. The first two entries have been built; the rest stand.
**Status:** deferred, not disputed. Each item has a known landing place.

Cut from the director plan to keep the first pass on one thing: getting a lineup on air. See
[multi-station.md](multi-station.md) for the other deferred half.

## Segments in a lineup — BUILT

A lineup line is a track or a segment, and the arm landed without a migration exactly as predicted,
because the items are jsonb (in `deadair.station_lineup` now; the `lineups` table this entry was
written against no longer exists). The rule landed with it: the director SKIPS a segment that is not
`ready` when the cursor reaches it, so the station never stalls waiting on a renderer.

Two things this entry did not anticipate, both of which turned out to matter. The line holds the
segment's ID and nothing else — no label, no state, no audio — because a copy inside a jsonb document
that is only rewritten on an edit would go stale the moment a segment was re-recorded. And a
talk-over is not a line at all: it never becomes an item, it rides on the record it is heard over.

## A DJ that talks — HALF BUILT

The audio path exists end to end: a segment airs, the station plants its own, and it can talk over a
record with the bed ducked under it. What does not exist is anything that writes or speaks one —
every segment is a file somebody recorded.

The remaining half, and the seams it drops into, is [dj-voice.md](dj-voice.md). The observation below
still holds and is why an LLM selector is cheap: `SetGenerator.generate` takes and returns *named*
picks (title + artist strings), which is what a model can produce, so it is a second binding rather
than a reshape.

## Live provider search when resolving a pick — BUILT

**Built 2026-08-12**, as `ProviderTrackLookup` behind `PickResolver.identify`'s third rung, gated by
`rotation.discover` (on by default) and bounded by `MAX_DISCOVERIES` per resolve. The entry was right
about when it would matter — a model naming songs the library does not hold — and it landed alongside
the operator brief, which is what made the library's ceiling audible: a station asked for heavy metal
whose playlists are ambient has nothing to choose from.

Four things came out differently from this sketch, and the last two were not anticipated at all.

**The scorer is stricter than "title/artist/duration".** Both the title and the LEAD artist must
match exactly on `normalizeKey`, which is the same normalization `deadair.tracks` is keyed by, so a
match here means what a catalog match means. Duration only breaks a tie between candidates that
already matched, taking the longer one so an album version beats a radio edit sharing its name. A
near-miss is refused, because the failure mode is not an error: it airs the wrong record while the
console says otherwise, and nobody watching would know.

**The pick is INGESTED rather than resolved to a provider URL.** The player fetches every record from
the app through `track_sources`, so a copy with no binding has no URL and cannot air — the catalog row
is the mechanism rather than bookkeeping. It also puts the record in front of the measurement,
enrichment and art passes, which all walk the catalog, so a discovered record is trimmed and
illustrated by the existing schedules with nothing new to write.

**The sync's missing sweep had to learn about it, and this is the part that would have been a silent
bug.** `markMissingTrackSources` marks every binding a clean playlist walk did not see. A discovered
copy is in no playlist and never will be, so the first hourly sync after a discovery would have
benched every record the station found for itself — a feature that worked for an hour and then
quietly stopped. `track_sources.origin` (`sync` | `discovered`) is the fix: the sweep judges only
`sync` rows, a walk that later sees a discovered copy moves it into the sweep, and a lookup never
moves a synced one out. What judges a discovered copy instead is fetching it, through the existing
four-consecutive-failure bench in `TrackAudioService`.

**Ordering against the rules is load-bearing.** Ingest happens inside `identify`, so `judge` runs
afterwards and a newly ingested record inherits whatever the operator already thinks of its artist.
Without that ordering, a record by a disliked act would air because nothing had an opinion about it
yet — which is `rejectDisliked` being routed around by a new path, the exact hole
[station-intelligence.md](station-intelligence.md) §1 records.

## Changing the brief on a live broadcast

**Written 2026-08-12**, from using the brief for the first time. `station_lineup.brief` is set when
the station goes on air and there is no way to change it after that: `PUT /director/air` sets the
air mode and nothing else, so re-steering an hour means calling `putOnAir` again, which replaces the
running order. An operator who wants the next fifteen records to lean differently has to throw away
the fourteen they already have.

The shape it wants is the shape everything else here has: a command posted to `DirectorService`
(`{ kind: 'rebrief', brief }`) that rewrites the binding and nothing else, a `PATCH /director/air/order`
in front of it, and an editable field where the header already draws `asked for: …`. The order is
untouched — what is planned stays planned — and the next refill reads the new brief because
`ExtendLineupJob` reads it off the row every time rather than being handed it.

Two decisions to make when it lands, neither obvious:

- **Whether a re-brief should discard what is planned but unheard.** It is the honest reading of "play
  something else" and it is also an operator losing programming they may have wanted. Leaning
  towards leaving it and letting the brief apply forwards, since dropping the tail is already
  expressible one item at a time.
- **Whether `name` follows the brief.** The console names a briefed broadcast after its brief, so a
  re-brief leaves the header saying something the station is no longer doing. They are separate
  columns for good reason and this is the one case where the split shows.

## The daypart schedule

Morning / afternoon / evening / night, each naming a PLAYLIST rather than a stored lineup: there is
no stored lineup to name any more, and a changeover builds the running order from its slot's source
the way `putOnAir` does. See `docs/decisions/on-air-ownership.md`, which also records why the
schedule must post commands and bump the epoch synchronously rather than writing anything itself.

The original entry, still true of the mechanism: The director already re-reads
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
tail so the bulletin airs next rather than five tracks later.

**Corrected 2026-08-11:** this entry used to say `station_air.resume_lineup_id` and `resume_cursor`
"already exist for handing the station back afterwards". They do not, and cannot: `station_air` is
down to one column of substance (`active`), because a second opinion about programming living next
door to the running order was the bug that on-air ownership closed. Handing the station back after a
bulletin is now what it always should have been — the bulletin is an item in the one running order,
and the records after it are still sitting behind it.

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

## The station console page — BUILT

`/onair` draws the live running order with each item's state, and offers Shuffle / Extend / Drop /
Stop. Put on air lives on the playlists page, beside the thing the order is built from. What is not
built: moving an item (the API route and the table's `onMove` seam both exist), and adding a segment
from the console.
