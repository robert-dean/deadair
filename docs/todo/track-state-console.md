# A record's state, in one place, and a way to clear it

Status: **built**, 2026-08-16, all three phases. What each one turned out to be is below its heading,
and what is left is at the bottom.

**Written:** 2026-08-15, from the operator's own ask: a way to see all the track data in the system
(cached, analyzed, enriched, and so on) plus the ability to clear those.

**State of the tree.** Everything a record accumulates already exists as rows. What does not exist is
anywhere to look at them together, and any way to throw one away short of a `psql` `delete`:

| Fact | Where it lives | Read by an operator today |
| --- | --- | --- |
| Canonical record | `deadair.tracks` | `GET /catalog/tracks` (list only; **there is no `/catalog/tracks/{id}`**) |
| Which providers hold a copy | `deadair.track_sources` (`playable`, `missing_at`, `origin`, bitrate, format, `last_seen_at`) | Nowhere |
| Bytes on this machine | `deadair.track_audio` per BINDING (`checksum`, `byte_size`, `fetched_at`, `attempts`, `last_error`, `next_attempt_at`) | Nowhere |
| Measurement | `deadair.track_analysis` (`schema_version`, `complete`, `analyzed_at`, `failed_at`, `failure_reason`) | Nowhere |
| Enrichment | `deadair.track_enrichment`, one row per provider | `GET /catalog/tracks/{id}/enrichment` |
| Opinion | `tracks.rating` (plus the album's and the artist's) | `PUT /catalog/tracks/{id}/rating` |
| What aired | `deadair.play_history` | `GET /activity`, by time rather than by record |

So of seven axes the console can show two. The gap is worst exactly where a record fails: a track
that will not air is silent about which of the three reasons applies (every binding benched, the
bytes unfetchable and backed off, or nothing wrong at all and it is simply inside the repeat window),
and the operator's only recourse is the database.

## Why it earns a page rather than a query

The specific loop this closes is the one already written up twice from the other end.
`docs/todo/provider-audio-failures.md` is an hour spent finding out that 13 of 581 records were
measured, and `docs/todo/analysis-queue-ordering.md` argues about which records the walk should pick
next — both of those are questions about the DISTRIBUTION of these columns, and neither is answerable
without writing SQL. The station also now benches a copy after four consecutive fetch failures
(`TracksRepository.markBindingMissing`) and writes off a record that cannot be served
(`DirectorService.thin`), so the number of ways a perfectly good-looking catalog row quietly cannot
air has grown, while the number of ways to see it has stayed at zero.

The clearing half is the other reason. Three of these rows are caches of something recomputable, and
`docs/todo/track-cache-eviction.md` already establishes the pattern: deleting a cached file is a
legitimate operator move, and `TrackAudioService.locate` treats a row whose file is gone as a
re-fetch and repairs the row on the way through. Doing that from a page is the same action with a
button on it.

## What to build

**Phase 1: a track detail read.** `GET /catalog/tracks/{id}`, and a `TrackDetail` contract that
carries the summary plus three arrays/objects the list cannot afford per row: bindings (from
`track_sources`, each with its `track_audio` state joined on), the analysis row, and the enrichment
providers with their `fetched_at`. `platform.view`, like the rest of `catalog.ck`. This is worth
having on its own: it is the page a console links to from a lineup item, from the activity feed and
from search.

**Phase 2: a library-wide state column set.** `GET /catalog/tracks` grows an optional projection (or
a second operation, decided against how wide `Track` is allowed to get) carrying three booleans and
nothing else per row: has local audio, measured at the current schema version, enriched by at least
one provider. Plus a `state` filter on `CatalogQuery` so "show me everything unmeasured" and "show me
everything benched" are one request. The counts belong beside it, because the aggregate is the thing
an operator actually reads first: N of M cached, N of M measured, N benched, N failing.

**Phase 3: clearing, one verb per cache.** All `platform.manage`, all on the track (or the binding
where the row is per binding), and each one is a delete of derived rows and nothing else:

- `DELETE /catalog/tracks/{id}/audio` — drop the `track_audio` rows for this record's bindings and
  the files behind them. Must go through `TrackAudioService` rather than the repository, because the
  in-memory `inFlight` map and the eviction rules in `track-cache-eviction.md` live there: **never
  clear a record inside the committable window**, since the director commits on audio being present
  and pulling the file out from under a committed item produces the silence the commit gate exists to
  prevent.
- `DELETE /catalog/tracks/{id}/analysis` — drop the `track_analysis` row so the walk picks it up
  again. This is the cheapest of the three to get right and the most useful, since a detector that
  was wrong about a class of records is exactly what `analyzer_plugin_id` was added to attribute.
- `DELETE /catalog/tracks/{id}/enrichment` — drop the `track_enrichment` rows, optionally for one
  provider. Note this must not touch `tracks.mbid`, which is identity rather than enrichment output
  even though enrichment is what resolved it.
- Clearing the fetch BACKOFF is its own verb and not part of clearing the audio:
  `next_attempt_at`/`attempts` reset, plus clearing `track_sources.missing_at`, is "try this again
  now" and is what an operator wants after fixing an upstream. Today the only thing that clears
  `missing_at` is the hourly sync re-sighting the copy.

## Rules it has to hold

- **Nothing here deletes a canonical row.** Every verb removes something the station can recompute.
  Deleting a `tracks` row is a catalog operation with merge semantics behind it and is a different
  feature; if it lands, it lands separately and says so.
- **A clear is an operator event.** These are the surfaces that already stamp
  `station_events.actor_id`, so a cleared cache belongs on the activity feed for the same reason
  `plugin.*` and `airMode.set` are there: it explains a re-fetch or a re-measure that would otherwise
  read as the station churning for no reason.
- **Report the failure rows rather than hiding them.** A `track_audio` row with a null checksum is a
  remembered failure and the page's job is to show it with its `last_error` and its next attempt
  time. The same for `track_analysis.failure_reason`. A page that showed only successes would be a
  worse version of the list that already exists.
- **`complete` is not `analyzed_at`.** A measurement of a truncated download is confident and wrong
  (`0005_music.sql` says so at length), so the page must show the two separately and the "measured"
  count must filter on `complete`, matching what every reader in `src/` already does.
- **Per binding, not per track, wherever the row is.** Two copies of one record within one provider
  are two files with different loudness and different cue points, and collapsing them on the page
  would make "clear the audio" ambiguous about which file it took.

## What is deliberately not proposed

**A page per axis.** The whole complaint is that these facts are scattered; four new console pages
would be the same scatter with a nicer font.

**A bulk clear over the whole library.** `rebuild:data` and the analysis walk already cover "start
again with everything", and a button that drops 581 files is a support call rather than a feature. A
filtered list with a per-row action is the version an operator can undo by waiting.

**Storing anything new.** Every column this needs exists, with one exception already argued for
elsewhere: `last_served_at` on `track_audio`, which
[track-cache-eviction.md](track-cache-eviction.md) wants for LRU and which this page would happily
show. It belongs to that file, not this one.

## What it turned out to be

All three phases landed on 2026-08-16, in the order this file set out, behind the eviction work in
[track-cache-eviction.md](track-cache-eviction.md) — which had to go first because `last_served_at`
could not be retrofitted, and which this page then got to show.

**Phase 1, the detail read**, is `GET /catalog/tracks/{id}` and `/catalog/tracks/$trackId`. One
change from the plan: enrichment is NOT part of it. `GET /catalog/tracks/{id}/enrichment` already
answers every provider's payload and the station's own sourced claims, and the page calls it
alongside and renders the existing panel — so the facts, with their quotes and their source links,
arrived for free and there is one enrichment shape rather than two.

The rules held. Per binding throughout; failures reported with their last error and next attempt;
`complete` shown separately from `analyzedAt`. One rule had to be added after a live row broke it:
**held is decided by the BYTES, not by `fetched_at`**, because the eviction sweep clears the file
columns and keeps the row, so a record fetched once and dropped since is not on this machine however
recently it arrived. It reads as `Dropped`, which is neither held nor a fault.

**Phase 2, the library-wide columns**, came out as three booleans per row (`hasAudio`, `measured`,
`enriched`), a `state` filter and a count strip. Two decisions worth keeping: `measured` means
complete AND at a schema version the station still trusts, and `benched` requires a copy to EXIST
first — a record nobody has a copy of reads as uncached, because "the lookup never resolved" and
"every copy written off" are different problems. The counts honour the search and deliberately ignore
the state filter, since they are what a filter is chosen from.

Against this install on the day: 919 records, 345 cached, 216 measured, 902 enriched, none benched,
four failing. The four were all `upstream answered 502` from one provider, which is the sort of
pattern that was invisible before.

**Phase 3, the clears**, are the four verbs this file named. The audio clear reuses the sweep's own
deletion path rather than growing a second one, which is what stops the two disagreeing about a file
two bindings share, and it REFUSES with a 409 inside the committable window rather than queueing —
the operator is standing there, and what they do about it is theirs to decide. Every clear is an
operator event with `actor_id`.

One thing this file did not say and the code now does: **clearing enrichment leaves `deadair.facts`
alone**. That is a decision rather than an oversight, and it is the one `fact-enrichment.md` records
as not yet made — a claim is the station's own argument with its evidence attached, and deleting one
from the console needs a permission rule and an answer about what re-extraction does to a claim an
operator has touched. The confirmation says so before the button is pressed.

## What is left

- **Clearing from the list.** Every verb is on the record's own page, so tidying up a class of
  records is one page each. The filtered list is where an operator would want it, and the reason it
  is not there yet is the same reason the bulk clear was refused above: a per-row action over a
  filtered set of 703 is a bulk clear wearing a hat.
- **The art and segment stores have no per-row clear at all**, only the figures on the settings page.
- **`analyzer_plugin_id` is shown and nothing filters by it**, so "re-measure everything that
  detector touched" is still a psql query — which is the exact shape of the problem this page was
  built to end, one level up.
