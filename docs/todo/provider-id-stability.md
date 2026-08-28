# When a provider renumbers, every binding the station holds is wrong

**Written:** 2026-08-28, from a reported upstream change rather than from anything measured here. It
is the only entry in this directory whose timing is set by somebody else's release schedule, which
is the whole reason it is written down before it has happened.

**State, end of 2026-08-28: phase 2 built, phase 1 done and the report confirmed, phase 3 conditional
on something that has not happened and may never.** The change is real, merged upstream and
unreleased; it moves ~87% of song ids on a current install and 100% on an old one; and **it can reach
nothing on either of this operator's installs, because neither has ever bound a local library.** The
guard from phase 2 is the part that was worth having, and it is worth having whether or not any of the
rest of this ever becomes live — it caught a page-cap bug that was already costing the station rows.
Read the next blocks in order — what was built, what was confirmed, what it costs — and then stop
unless a local library has since been bound.

**Phase 2 is BUILT, 2026-08-28**, taken before phase 1 on the grounds stated below, that the guard is
correct on a provider that never renumbers. It landed as the shape this file specifies, plus three
things it did not name:

- **A third way to reach the same catastrophe, and it needed no renumber at all.**
  `pluginPages` stopping at `PLUGIN_MAX_PAGES` yielded its last item and returned like any other
  generator, so a walk truncated at ten thousand items looked complete to `CatalogSyncService` —
  `summary.error` unset, sweep runs, everything past the cap retired for never having been looked at.
  A provider that ignores `offset` produces this on a library of any size. The cap said so at `warn`,
  which is not something a caller can act on; `PluginPageRequest.onTruncated` is, and a truncated walk
  now ends the same way a throw or a cancellation does. Fixed first, as its own commit, because it is
  live today where the renumber is a report.
- **The threshold is a setting, `catalog.sweepMaxPercent`, defaulting to 50 with 100 meaning the guard
  is off.** No separate switch: a percentage that says "retire whatever the walk did not see" already
  spells that, and a boolean beside it would be a second way to say one thing. The escape hatch
  matters more than it first looks, because a genuine library-wide reorganisation is a case the guard
  refuses and the per-track bench cannot fix — those tracks still exist on the server, they are simply
  no longer in a playlist, so nothing will ever fail to fetch them.
- **A floor of twenty live `sync` bindings, under which the proportion is not applied.** On four
  bindings, losing three is 75% and completely ordinary; a guard that fired there would be turned off
  before it was ever needed.

**Measured on this install while building it:** 597 live `sync` bindings, all from one provider, and
769 cached audio files. Comfortably past the floor, so a renumber here meets the guard rather than
sailing past it. `apps/api/scripts/catalog.sweep.smoke.ts` presents the real repository with an actual
renumber inside a rolled-back transaction and checks both that it refuses and that the ordinary sweep
still works — the count and the update share a predicate written out twice, and a disagreement between
the two copies would be invisible from either side.

**Phase 3 is untouched, and is cheaper than this file assumes.** See phase 1's findings below.

**The report is CONFIRMED, 2026-08-28, and it is more precise than it was reported.** ~~That claim is
second-hand and is not yet checked against the server's own release notes or a running upgrade.~~ The
primary source is upstream's own pull request (#5824, "migrate all ids to a uniform canonical 128-bit
base62 encoding"), **merged to master 2026-08-02 and not in any release yet** — the newest tag is
still the one from 2026-07-11. So the deadline is real, dated by somebody else, and has not arrived.
The migration runs once on first start after the upgrade and is one-way; upstream's own advice is to
back the database up first.

**What actually changes, which the report got half right and half wrong:**

| | Report said | Upstream says, with its own measurements |
| --- | --- | --- |
| Song ids | all new | **~87% change** on a recent install (10,593 of 12,123 measured), **100%** on an older one whose ids are legacy 32-hex (84,325 of 84,325) |
| Album and artist ids | (not mentioned) | **Unchanged.** They are hash-derived and already in the target format |
| MusicBrainz ids | (not mentioned) | **Never touched**, and explicitly excluded because the transform would corrupt them |

**87% is the number that matters, and it is an argument about the guard's default.** A threshold of
50 catches both 87% and 100%. A threshold of 90 — which is the kind of figure "only refuse a total
wipe" reasoning arrives at — would let the recent-install case through, which is the case a
present-day operator is most likely to be in. **Do not tune `catalog.sweepMaxPercent` upward toward
100 on the theory that only a total renumber is worth refusing.** The real event is not total.

**What it costs THIS install today: nothing.** The Subsonic plugin has no config row, is not enabled,
and holds zero bindings; all 782 bindings on this station come from the streaming provider, whose ids
this change cannot touch. So the deadline is real and the exposure is currently zero, and phase 3
does not become worth building until the operator points the station at a local library.

**The cost estimate in this file was wrong in an instructive way.** It read "on the live install today
that is 766 tracks with local audio, per-copy `advisory`, `isrc` and format, and the analysis row".
The 766 is right and the attribution is not: those are the streaming provider's bindings, counted
without checking whose they were. **A blast radius is a count of the rows a change can reach, not a
count of the rows that exist.**

**Both installs, and the exposure is zero on both.** The numbers above are from the database on
`localhost:55432`. The station's other Postgres on the LAN could not be read from the sandbox (a
direct connection is `EPERM` and the SOCKS proxy answers "connection not allowed by ruleset"), so the
operator checked it: **it holds no Subsonic bindings either.** Nothing in this tree is exposed to the
change, on either install, today.

## Why it lands harder here than it looks

`deadair.track_sources.external_id` holds the provider's own id verbatim (`0005_music.sql:141`), and
for this provider that is the library server's song id, mapped straight off the payload in
`plugins/navidrome/src/navidrome.mapping.ts` (`mapTrack` refuses a song with no id and copies it
through otherwise). Four things hang off it, in the order they would break:

1. **Resolution and audio.** A binding is how the station turns a pick into bytes. Every lookup by
   `external_id` answers nothing at once, for the whole library rather than for a few tracks.
2. **The missing sweep marks everything.** `source: 'sync'` bindings are judged by whether a clean
   walk saw them. A walk after a renumber sees a full library of ids it has never met, so it marks
   every existing binding `missing_at` and ingests the same songs again beside them. To the sweep
   this is indistinguishable from the operator deleting their library.
3. **The local audio goes with it.** `track_audio.source_id` references `track_sources (id) on
   delete cascade` (`0009_track_audio.sql:25`). Whatever eventually retires the orphaned bindings
   takes the cached bytes with them, and the station re-fetches a catalog it already had.
4. **`play_history.external_id` dangles**, which is harmless: it is a record of a moment and is not
   read to resolve anything.
5. **`playlist_tracks.origin_external_id` stops matching**, which phase 1 added to this list because
   the original four missed it. It degrades correctly on its own: `CatalogPlaceholderService.findTrack`
   asks the binding first and falls back to `origin_snapshot`, the metadata the importer recorded
   beside the id. That is phase 3's whole argument already built and already shipping, one table
   along, and it is the reason phase 3 is a smaller job than it reads.

**Two tables that look exposed and are not.** `album_sources` and `artist_sources` also hold an
`external_id`, and nothing in `apps/api/src` writes either of them (both are empty here). It would not
matter if they did: album and artist ids are the half of upstream's change that does not move.

**This is not the failure `provider-audio-failures.md` describes.** That one is a provider answering
for some tracks and not others, with the station correctly refusing the ones it cannot fetch. This
is every track at once, and the station's own correct behaviours (sweep what a walk did not see,
cascade audio off its binding) are what turn a renumber into a rebuild.

**And there was a third, found while building phase 2 and already live.** A walk truncated at
`PLUGIN_MAX_PAGES` reached the sweep looking complete, so everything past ten thousand items was
retired for never having been enumerated. Different cause, same destination, and it needed no upstream
release to happen. The lesson worth keeping is the one the fix is shaped by: **the sweep's real
precondition is "this walk saw the whole library", and that had been standing on the absence of an
exception.** Anything that grows a fourth way for a walk to be partial has to say so, rather than
returning quietly and letting the guard's proportion catch it by luck.

## The rule underneath it

**A provider id is a LOCATOR, not an identity.** This tree already believes that everywhere else:
identity is `artist_key` and `title_key` through the resolver, which is exactly why
[backup-and-restore.md](backup-and-restore.md) keys an export by natural keys and never by uuid, and
why the same resolver decides what airs. `track_sources` is the one place the locator is load-bearing,
and it is load-bearing for a good reason. The fix is not to stop storing it. It is to stop treating
its disappearance as a fact about the music.

## Three phases, in order, and the second is worth doing alone

**Phase 1: confirm the shape, and cost it on this install.** ~~Read the server's release notes and, if
possible, upgrade a copy and diff the ids.~~ **Done 2026-08-28**; the findings are at the top of this
file. It did not need an upgrade and a diff: upstream's own pull request carries the before-and-after
counts from a 96k-track database, which is a better measurement than one taken here would have been.

**The method is the part worth keeping.** The instruction was "read the release notes", and the
release notes did not exist yet — the change is merged and unreleased, so a search that stopped at the
tag list would have concluded the report was wrong. The confirmation was in the merged change itself.
**For a deadline set by somebody else's release, the release is the last place the answer appears.**

That it cost nothing here is also the answer to "what is the urgency of phase 3", and the answer is
none until this station binds a local library at all.

**Phase 2: a walk that recognises nothing is not evidence of an empty library.** ~~The sweep should
refuse to mark every known binding missing in a single pass, on a threshold rather than a count of
one.~~ **Built 2026-08-28**; see the top of this file. This is the same argument `AudienceWatch`
already makes and documents: an answer that failed and an answer of zero are the same number and
completely different evidence, and inferring the destructive one silences the station. Cheap,
self-contained, and correct against a provider outage, a mid-walk credential expiry and a renumber
alike — and, as it turned out, against a page cap nobody had connected to this.

**What was deliberately not built, so it is not re-argued.** Relenting after two or three consecutive
walks that agree would self-heal a genuine library-wide reorganisation with no operator action. It
needs remembered per-plugin state (the last refused seen-set, or a count), which is a table or a
column and a sweep of its own, and this was meant to be the cheap half. The setting is the escape
hatch instead. Re-open it if the refusal is ever hit for a real reason rather than a renumber.

**Phase 3: re-bind rather than re-ingest.** The seam already exists.
`plugins/navidrome/src/navidrome.match.ts` has `selectSong` over a `MatchRef`, which is a search by
what a record IS rather than by where it was. For a binding whose id no longer resolves, search, and
rewrite `external_id` in place. Rewriting rather than inserting is the whole point: it keeps the local
audio, the ratings, the measurement and the play history attached to the row that already earned them,
where a re-ingest strands all four.

One rule to hold on the rewrite, and it is `clean-copy-matching.md`'s rule reached from another
direction: the re-match must be **stricter on identity than the ordinary lookup**, because it is
writing to a row that already has a correct answer rather than proposing a new one. A loose match here
does not fail to find a record, it silently re-points a binding at a different one, and the symptom
arrives weeks later as the wrong song.

**Phase 3 has an expiry date, and it is probably already past.** It is worth building for exactly one
situation: a local library bound to this station BEFORE the operator upgrades their server, and still
bound after. Neither install has ever bound one. So the window is the gap between now and whenever the
operator both connects a library and upgrades past the migration — and if the library is connected
AFTER that upgrade, the ids are already in the new format, a first ingest binds them, and there is
nothing to re-bind. **Do not build this speculatively.** Build it if a local library is bound while
the server is still on an old release; otherwise close this phase when the upgrade has happened.

**Phase 1 makes most of that rule unnecessary, which is the finding that shrinks this phase.** The
worry above is a worry about fuzzy matching, and for most of a catalog the match need not be fuzzy.
Upstream excludes MusicBrainz ids from the migration *by name*, on the grounds that the transform
would corrupt them, so an mbid is an identifier that survives the renumber by design. The payload
already carries one (`SubsonicChild.musicBrainzId`, mapped in `navidrome.enrichment.ts`) and
`deadair.tracks.mbid` already stores it: **745 of 766 tracks here have one, and every binding has an
`isrc`.** So the shape of phase 3 is a ladder rather than a search — exact mbid first, then `isrc`,
and `selectSong` over a `MatchRef` only for the remainder, which is where the strictness rule applies
and where it is affordable because the remainder is small. Do not build the fuzzy path first: it is
the least of the three and it is the only one that can be wrong.

## What this does not cover

The Spotify side of the same question is [spotify-api-currency.md](spotify-api-currency.md), which is
about a provider changing its API rather than its identifiers. Nothing here applies to it: those ids
are catalog ids and are stable by contract, and the relink case there is already expressed as
`playable`.
