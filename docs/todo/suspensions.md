# Deferred: suspending a record, a release or an artist for a while

**Written:** 2026-09-09, from an operator wanting Metallica off the station for five days without
saying they dislike Metallica.
**State of the tree:** nothing here is built. An opinion is the only lever, it is permanent, and
there are exactly three of them (`liked`, `neutral`, `disliked`).

---

## What is being asked for

"Stop considering this for five days." A tired record, an artist the station has leaned on all week,
a release that is about to be everywhere because of a film and should be given until after. The
operator is not passing judgement on the thing. They are making a scheduling decision that has an
end date, and they want it to lapse without anybody having to remember it.

## Why a dislike is the wrong tool, stated once

A dislike is an **instruction with no end**, and the whole tree treats it that way on purpose.
`rejectDisliked` in [rotation.rules.ts](../../apps/api/src/modules/director/rotation.rules.ts) is
documented as "not a rotation rule, and not disable-able by a lineup", the three rating verbs in
[catalog.ck](../../apps/api/data/contracts/catalog/catalog.ck) each override their file's read floor
to take `platform.manage`, and `CandidatesRepository.effectiveRating` takes the veto before it takes
anything else. That is a deny, and it should stay one.

Three things go wrong if a suspension is spelled as a dislike and undone by hand:

1. **It is the same column, so it destroys the opinion.** An operator who liked Metallica and then
   suspends them has to overwrite `1` with `-1`, and when the five days are up there is nothing left
   that remembers the `1`. `weightOf` reads that same number to double a liked record's draw weight,
   so the suspension quietly costs the like as well.
2. **Nothing lapses.** There is no expiry anywhere near a rating, so the undo is a diary entry in a
   human's head. The failure mode is not an outage, it is an artist who is off the station for four
   months because nobody wrote it down.
3. **The console cannot tell them apart.** A dislike and a suspension look identical on the row, so
   "why is this not playing" has two answers with one spelling.

## Why the two neighbouring deferred files are also not this

[never-play-rules.md](never-play-rules.md) is a **predicate over a kind of thing**: never play
country western, never play anything tagged `christmas`. This is an instance, named by id, and the
two mechanisms want opposite things (a rule is absolute and permanent, a suspension is absolute and
brief). Sharing a table would be sharing nothing but a `where`.

[repeat-overrules.md](repeat-overrules.md) is this file's mirror image and worth reading beside it:
it takes rotation rules OFF for a stretch so a Metallica hour can happen, where this puts one ON for
a stretch so a Metallica week cannot. Neither is the other's implementation.

**The artist cooldown is the near miss, and it is the wrong answer.** `rules.artistCooldownMinutes`
would technically hold an act off for five days if it were set to 7200, but it is one number for
every artist on the station, it is per-lineup and therefore overridable, and it is resolved through
`ResolvedRules` where `NO_RULES` zeroes it. A suspension has to survive a setlist for the same reason
a dislike does.

## The vocabulary, because two of the obvious words are taken

- **Bench** means a provider binding with `missing_at` written on it (`TrackAudioService.bench`,
  the `benched` filter in [track.state.filter.tsx](../../apps/web/src/components/catalog/track.state.filter.tsx)).
  It is about a copy that will not fetch, not about a decision.
- **Rest** means the cooldown on a fact, a persona note, a persona story or a pad, all of which is
  `last_used_at` and a `nulls first` ordering. It is a rotation, not a bar.
- **Suspend** is free, and it is also what an operator would say out loud.

## What is already in the tree, and what it buys

**The chokepoints exist, all of them, and they are the same ones a dislike already passes through.**
That is what makes this small, and it is also the one rule the design may not break: enforcement is
inherited from the dislike path, never added beside it.

- [candidates.repository.ts](../../apps/api/src/modules/director/candidates.repository.ts):
  `sample` narrows the draw with three `rating <> -1` predicates, and `ratingsFor` answers for picks
  a generator produced without touching the catalog.
- [pick.resolver.ts](../../apps/api/src/modules/director/pick.resolver.ts): `judge` for a generated
  set and `vet` for a playlist put on air, both of which reach `rejectDisliked` over `ratingsFor`.
  The third route in (`DirectorConsoleService.addTrackToOrder`, an operator inserting one catalog
  record into the running order at a position) passes the record through the same `vet` rather than
  going around it.
- [tracks.repository.ts](../../apps/api/src/modules/catalog/tracks.repository.ts): four reads the
  model's `search_music` tool sits on, each with its own copy of the dislike predicate —
  `searchPlayable`, `ownership`, `dislikedArtistKeys` and `styleVocabulary`.

**`station_lineup.hold_until` is the shape precedent** ([0017_schedule.sql](../../apps/api/data/migrations/0017_schedule.sql)):
a nullable `timestamptz`, null meaning "no hold", read at the point of use by
`DirectorService.holdUntil` and the schedule tick, with no sweeper job anywhere. Copy that, with one
deliberate difference below.

## The shape

**Three columns, not a table.** `suspended_until timestamptz` on `deadair.tracks`, `deadair.albums`
and `deadair.artists`, beside the three `rating` columns they already carry. The reason is that
`effectiveRating` collapses three levels plus every credited artist with `least`/`greatest` and a
suspension has to collapse across exactly the same three, in the same expression, or the two answers
drift the first time somebody suspends a release and not its songs. A side table would be a fourth
join to reproduce a collapse that already exists.

What a table would have bought is a reason string and a history of past suspensions. Neither is worth
a join: the reason belongs on the activity feed, which is where every other operator action that
changes what airs is already recorded, and a lapsed suspension is not a thing anybody queries.

**Read at the point of use, never swept.** The predicate is
`suspended_until is null or suspended_until <= now()`. No expiry job, no `updated_at` pass, nothing
that can fail overnight and leave an artist off the air. A lapsed row is indistinguishable from one
that was never suspended, which is exactly what it should be.

**`infinity` is refused, unlike `hold_until`.** Postgres supports it and the hold uses it for "until
I say otherwise", but an indefinite suspension is a dislike, and shipping both would be two spellings
of one state with two consoles to set them from. A suspension has a ceiling.

**It does not touch the rating.** `RotationCandidate` gains `suspendedUntil?: number` beside
`rating?: number`, and `CandidatesRepository.ratingsFor` widens from `Map<string, number>` to a map of
`{ rating, suspendedUntil }`. That widening is most of the actual work in Phase 1, and it is why the
`ratingsFor` name stops being right.

**One filter, not two.** Fold the suspension into `rejectDisliked` and rename it (`rejectBarred`)
rather than exporting a `rejectSuspended` beside it. Every site that must drop a dislike must drop a
suspension, and a second function whose entire contract is "always call me next to that one" is how
the two end up enforced in different numbers of places. That is the same failure `never-play-rules.md`
names as its first rule.

**No per-lineup override.** `NO_RULES` may not lift it, for `rejectDisliked`'s reason: a suspension
is an instruction about what the station may play, not a preference about how often.

## What it does not do

**It does not empty the running order.** A commit already made stands, exactly as it does for a
dislike, because the director is the sole writer of what airs and a rating verb reaching in to
rewrite the order would be the second stateful owner `director.md` § "Who owns the running order"
exists to prevent. The operator already has `DELETE /director/air/items/{itemId}` for the two or
three items in front of them, which is the correct scale for this.

**It does not do "except on Fridays", and it does not scope to a lineup or a slot.** That is
`never-play-rules.md`'s axis, and it belongs there when it is built.

## Phases

**Phase 1: the column and the draw.** One migration adding `suspended_until` to the three catalog
tables. `effectiveRating`'s neighbouring suspension expression, the three predicates in `sample`, the
four in `TracksRepository`, `ratingsFor` widened, `rejectDisliked` renamed and doing both. No way to
set one except `psql`, which is fine: the tree builds, the tests pass, and nothing behaves
differently until a row has a value. *Commit: "director: a suspension keeps a record out of the draw
until it lapses".*

**Phase 2: the verbs.** `PUT` and `DELETE` on `/catalog/artists/{id}/suspension`,
`/catalog/albums/{id}/suspension` and `/catalog/tracks/{id}/suspension`, at `platform.manage`, each
overriding the file's read floor the way the three rating verbs do. `SuspendInput { days: int(min=1,
max=365) }`, required, mirroring `HoldStationInput.minutes` but with no absent case because there is
no indefinite state. The three contracts answer with the same `Artist` / `Album` / `Track` re-read
that the rating verbs answer with, so `suspendedUntil?: string` (ISO-8601, per the JSON-safe rule)
joins `rating` on all three. One activity entry per set and per clear. *Commit: "catalog: an operator
can suspend an artist, a release or a record".*

**Phase 3: the console.** A control beside `RatingControl` and explicitly not inside it: the existing
segmented control is one question with three answers, and a fourth segment would make "suspended"
exclusive with "liked" when the whole point is that they are orthogonal. It shows the remaining time
rather than the timestamp, because five days is what was asked for and 2026-09-14T08:12:03Z is not
what anybody typed. Plus a `suspended` state in
[track.state.filter.tsx](../../apps/web/src/components/catalog/track.state.filter.tsx) with its
count, which is where [track-state-console.md](track-state-console.md)'s Phase 2 already puts the
other seven axes. *Commit: "web: suspend and un-suspend from the catalog".*

## Verify before building

Named against the tree on 2026-09-09. Check that `ratingsFor` still has two callers and only two
(`judge` and `vet`), that `TracksRepository` still carries the dislike predicate in the same four
methods, and that `rejectDisliked` is still the single in-memory filter, before assuming any of the
above is still the shape of the work.
