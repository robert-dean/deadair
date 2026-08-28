# When a provider renumbers, every binding the station holds is wrong

**Written:** 2026-08-28, from a reported upstream change rather than from anything measured here. It
is the only entry in this directory whose timing is set by somebody else's release schedule, which
is the whole reason it is written down before it has happened.

**The report, and its confidence.** A Subsonic library server is said to be changing how it
generates song identifiers, so an operator who upgrades gets a library in which every id is new and
none of the old ones resolve. That claim is second-hand and is **not yet checked against the
server's own release notes or a running upgrade**. Phase 1 below is confirming it. The design work
here is worth doing either way, because the guard it asks for is correct on a provider that never
renumbers at all.

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

**This is not the failure `provider-audio-failures.md` describes.** That one is a provider answering
for some tracks and not others, with the station correctly refusing the ones it cannot fetch. This
is every track at once, and the station's own correct behaviours (sweep what a walk did not see,
cascade audio off its binding) are what turn a renumber into a rebuild.

## The rule underneath it

**A provider id is a LOCATOR, not an identity.** This tree already believes that everywhere else:
identity is `artist_key` and `title_key` through the resolver, which is exactly why
[backup-and-restore.md](backup-and-restore.md) keys an export by natural keys and never by uuid, and
why the same resolver decides what airs. `track_sources` is the one place the locator is load-bearing,
and it is load-bearing for a good reason. The fix is not to stop storing it. It is to stop treating
its disappearance as a fact about the music.

## Three phases, in order, and the second is worth doing alone

**Phase 1: confirm the shape, and cost it on this install.** Read the server's release notes and, if
possible, upgrade a copy and diff the ids. The number that decides the urgency of phase 3 is how much
is attached to a binding here: on the live install today that is 766 tracks with local audio, per-copy
`advisory`, `isrc` and format, and the analysis row. If the answer is that ids are stable and the
report was wrong, phase 2 is still correct and this file closes.

**Phase 2: a walk that recognises nothing is not evidence of an empty library.** The sweep should
refuse to mark every known binding missing in a single pass, on a threshold rather than a count of
one. This is the same argument `AudienceWatch` already makes and documents: an answer that failed and
an answer of zero are the same number and completely different evidence, and inferring the destructive
one silences the station. Cheap, self-contained, and correct against a provider outage, a mid-walk
credential expiry and a renumber alike.

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

## What this does not cover

The Spotify side of the same question is [spotify-api-currency.md](spotify-api-currency.md), which is
about a provider changing its API rather than its identifiers. Nothing here applies to it: those ids
are catalog ids and are stable by contract, and the relink case there is already expressed as
`playable`.
