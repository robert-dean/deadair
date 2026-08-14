# Nothing removes a cached record

**Written:** 2026-08-14, when `playout.trackCache` was removed and keeping every record became
unconditional.
**State of the tree:** `TrackAudioService` writes every record it fetches into `TRACKS_DIR` through
`TrackStore`, content-addressed, and `deadair.track_audio` holds one row per binding saying which
file. **Nothing ever deletes either.** `TRACKS_DIR` grows for as long as the station runs.

## Why the switch that used to cover this is gone

`playout.trackCache` was a boolean: off meant the station neither served from the cache nor filled
it, and a fetched record went into a small bounded in-memory hold instead of onto disk. It was
removed rather than defaulted, because its off state stopped being expressible. A record may not
enter the committable window until its audio is on this machine
(`docs/decisions/bytes-before-air.md`), so a station keeping nothing would have nothing ready and
would never commit anything at all — the switch had become a way to make the station silent.

What it was actually reached for was A/B-ing a suspected bad cached file, and that is better served
by deleting the file: `TrackAudioService.locate` already treats a row claiming bytes the disk has not
got as a re-fetch, and repairs the row on the way through.

So the disk cost is now unconditional, and this file is the bill.

## What it costs, measured against this install

A 320kbps Ogg is roughly 8–10 MB for a four-minute record; a FLAC from a Navidrome library is 25–40
MB. At 581 catalog tracks that is somewhere between 5 GB and 20 GB for the whole library, which is
not alarming — the shape of the problem is not the current catalogue, it is that **discovery has no
ceiling**. `PickResolver.identify` ingests records from providers that were never in a playlist
(`CLAUDE.md`, the discovery gotcha), so the set of records the station can fetch is the provider's
catalogue rather than the operator's library.

## What to build

**A byte cap and an LRU sweep**, in that order of importance:

1. `playout.trackCacheMaxBytes`, a `number` field in `settings.registry.ts` beside the playout knobs.
   Zero or unset means no cap, which is today's behaviour and has to stay reachable.
2. A sweep that deletes least-recently-used files until the total is under the cap. `track_audio`
   already carries `fetched_at`; what it does NOT carry is a last-READ time, and a cache evicted by
   fetch time throws away exactly the records the station plays most. **Add `last_served_at`, written
   by `TrackAudioService.locate` on a cache hit**, and evict on that. This is the one piece that
   cannot be retrofitted later without a period of evicting the wrong files.
3. Deleting a file means clearing `checksum`/`ext`/`content_type`/`byte_size` on the row and leaving
   the row itself, which is the same shape `recordFailure` already leaves: the row is the record of a
   binding, not of a file.

## Three rules it has to hold

- **Never evict a record inside the committable window.** The director commits on audio being here,
  so an eviction pass that took a file out from under a committed item would produce exactly the
  silence the commit gate exists to prevent. The window is `StationLineup.committedThrough()` forward
  by `CACHE_AHEAD`; anything in it is off limits.
- **Never evict what is being fetched.** `TrackAudioService.inFlight` is the check, and it is in
  memory, so the sweep belongs in that class rather than in a job that only has the database.
- **Under-cap is not a reason to do nothing.** A file with no row, or a row with no file, is the
  state a crash mid-write leaves; the sweep is the only thing that would ever notice either. Report
  both rather than silently repairing, at least at first: a store that quietly deletes files it
  cannot account for is a bad thing to debug.

## What is deliberately not proposed

**A size cap per record.** `MAX_TRACK_BYTES` already refuses anything over 64 MB, and it refuses it
by serving nothing at all rather than by truncating, which is the right trade and needs no second
mechanism.

**Evicting on a schedule.** The cap is the thing an operator can reason about; a nightly sweep that
deletes a week-old record on a station with 4 TB free is a worse default than doing nothing.
