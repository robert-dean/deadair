# Nothing removes a cached record

Status: **built**, 2026-08-16. What is left is at the bottom.

**Written:** 2026-08-14, when `playout.trackCache` was removed and keeping every record became
unconditional.
**State of the tree then:** `TrackAudioService` wrote every record it fetched into `TRACKS_DIR`
through `TrackStore`, content-addressed, and `deadair.track_audio` held one row per binding saying
which file. **Nothing ever deleted either.** `TRACKS_DIR` grew for as long as the station ran.

## Why the switch that used to cover this is gone

`playout.trackCache` was a boolean: off meant the station neither served from the cache nor filled
it, and a fetched record went into a small bounded in-memory hold instead of onto disk. It was
removed rather than defaulted, because its off state stopped being expressible. A record may not
enter the committable window until its audio is on this machine
(`docs/decisions/bytes-before-air.md`), so a station keeping nothing would have nothing ready and
would never commit anything at all — the switch had become a way to make the station silent.

What it was actually reached for was A/B-ing a suspected bad cached file, and that is better served
by deleting the file: `TrackAudioService.locate` already treats a row claiming bytes the disk has not
got as a re-fetch, and repairs the row on the way through. There is now a button for exactly that;
see below.

So the disk cost is now unconditional, and this file was the bill.

## What it costs, measured against this install

A 320kbps Ogg is roughly 8–10 MB for a four-minute record; a FLAC from a Navidrome library is 25–40
MB. At 581 catalog tracks that is somewhere between 5 GB and 20 GB for the whole library, which is
not alarming — the shape of the problem is not the current catalogue, it is that **discovery has no
ceiling**. `PickResolver.identify` ingests records from providers that were never in a playlist
(`CLAUDE.md`, the discovery gotcha), so the set of records the station can fetch is the provider's
catalogue rather than the operator's library.

Measured again on the day it was built: 919 catalog tracks, 345 of them held, 3.5 GB. The library had
grown by 58% in two days, which is the ceiling argument arriving rather than a surprise.

## What was built

**`playout.trackCacheMaxBytes`, unset by default**, and a sweep that drops the least recently played
records until the total is under it. Three things about the shape it took.

**The cap is the trigger and age is only the order.** An under-cap run reads one aggregate and stops,
so a station inside its cap is untouched however often the sweep fires. That is what made the "no
schedule" rule below survivable in the form it took.

**It runs as its own job**, `playout.sweep_track_cache`, every fifteen minutes — NOT off the commit
pass, which was the obvious place and is wrong twice over: that loop keeps the running order full
and is the one an operator hears when it is slow, and the ripener's subject is the fetch window
rather than the disk. What the ripener keeps is one line, `TrackAudioService.protect`, publishing the
records the sweep may not touch. That is also how the committable-window rule is honoured without
`playout` depending on `director`, which would be a cycle — the director already imports the planner.

**`last_served_at` went in first, on its own**, as this file said it had to. It is `not null` with a
`now()` default, which the file did not predict and which is the better shape: a null would be a row
the sweep has to have an opinion about, and the honest default for a record fetched and not yet
served is the moment it arrived. That also makes the index a plain btree with no coalesce and no
nulls-first trap. It is written on a cache HIT and nowhere else — deliberately not in `readyFor`,
which stats the same window every few seconds and would report the whole forward order as freshly
served, flattening the ordering the sweep depends on.

## Three rules it has to hold — all three held

- **Never evict a record inside the committable window.** Enforced through the protected set
  described above, and the sweep reports being stuck over the cap rather than forcing its way under.
- **Never evict what is being fetched.** `TrackAudioService.inFlight`, read fresh on every round of
  the sweep rather than once, because a fetch that finishes mid-sweep is a record that must not be
  taken.
- **Under-cap is not a reason to do nothing.** This became `GET /storage` rather than a sweep-time
  report, which is better: the numbers are on the settings page instead of in a log nobody reads.
  Report and never repair, as the rule said. It found 151 unclaimed art files and 125 unclaimed
  segment files on its first run.

One thing the file did not anticipate: **a file two bindings share must not be deleted for one of
them**. The store is content-addressed, so identical audio is one file, and the sweep clears the rows
first and then deletes only the checksums no surviving row still references.

## What is deliberately not proposed — still not

**A size cap per record.** `MAX_TRACK_BYTES` already refuses anything over 64 MB by serving nothing
at all rather than by truncating.

**Evicting on a schedule.** The sweep runs on a cron and this rule survives intact, because what it
refuses is evicting on AGE. The cap is what decides whether anything happens at all.

## What is left

- **A cap on anything but records.** Art and segments grow too — 135 MB and 37 MB here — and neither
  has a limit or a sweep. Both are far smaller and neither has discovery's open ceiling, so this is a
  bill to keep an eye on rather than one to pay.
- **Repairing what the storage report finds.** It counts orphans in both directions and deletes
  nothing. Doing something about them needs a rule about what a file with no row means when a write
  was interrupted a second ago rather than a week ago, and that rule wants the numbers this now
  produces.
- **A per-record clear from the console** is BUILT (`DELETE /catalog/tracks/{id}/audio`), including
  the refusal inside the committable window. See `track-state-console.md`.
