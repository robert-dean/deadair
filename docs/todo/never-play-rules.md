# Deferred: never-play rules, beyond a dislike

**Written:** 2026-08-19, from asking how a station is told to refuse a genre.
**State of the tree:** nothing here is built. The operator can forbid a THING (`tracks.rating`,
`albums.rating`, `artists.rating` at `-1`, collapsed by `CandidatesRepository.effectiveRating` and
enforced by `rejectDisliked`). There is no way to forbid a KIND of thing, so "never play country
western" is expressible only by disliking every artist by hand.

This file supersedes [station-intelligence.md](station-intelligence.md) §5, which is the original
design and is still worth reading for the two rules it states. What is here is that design plus what
the tree looks like now: §5 was written before `PickResolver` existed as the single chokepoint, and
before there was a `RotationCandidate` to hang a predicate off.

---

## What a rule is, and what it is not

A **predicate**: never play this genre, this tag, this mood, anything on this playlist, anything by
this artist. Two rules from §5 are load-bearing and neither is negotiable.

**Enforcement is inherited, never added.** Rules evaluate at the chokepoints a dislike already passes
through. A second filter bolted onto a pick path is how the two kinds drift until one is enforced in
three places and the other in two.

**A rule is absolute, like a dislike.** No never-starve exception, including for a listener request.
A rule that quietly relaxes under pressure is worse than no rule, because nobody can reproduce it.

The corollary, which §5 states as a console note and is really a design constraint: offer no
one-click undo on a row that a RULE excluded. One rule can cover hundreds of rows, and the edit
belongs where the rule is rather than where a symptom of it showed up.

## What is already in the tree

**The chokepoint exists, so §5's first rule is already paid for.**
[pick.resolver.ts](../../apps/api/src/modules/director/pick.resolver.ts) is documented as the one
step every pick from every source passes through, and every generator's comments defer to it by name.
It has exactly one caller, `plan.records.ts:120`. A rule engine hung off `PickResolver.judge` costs
one call site.

**The genre data is the enrichment arrays, not the promoted column.**
`track_enrichment.data -> 'genres'` and `artist_enrichment.data -> 'genres'`, both jsonb, one row per
provider. [`taggedWith()`](../../apps/api/src/modules/catalog/tracks.repository.ts) is already the
correlated union over both levels, guarded by `jsonb_typeof` because plugins write it. Both levels
count for the reason that file gives: a tag on the artist is how a style reaches a record nobody
tagged individually, which on this library is most of them.

`tracks.genre` is a promoted `genres[0]` (`enrichment.service.ts`, in `promote`). Per §6 the array is
the data and the scalar is a convenience, so **the matcher reads the arrays and never the scalar**.
The scalar stays exactly as it is, for display and for `searchPlayable`.

**`RotationCandidate` carries nothing a predicate could read.** It is `{ songKey, artistKey, rating? }`.
This is the one seam §5 does not mention, and it is the real work: `PickResolver` already fetches
`ratingsFor(trackIds)` so a dislike is true for picks that never touched the catalog, and a genre rule
needs the identical shape beside it.

## Decisions

**Exclude only. No `require` direction.** A positive "only these genres" can starve the station, which
fights the rule that the deterministic floor cannot fail. Positive format steering already has a home:
`station_lineup.brief` and the set generators.

**No weight column, ever.** §5's own "The bubble, which the rules above cannot fix" says the fix for a
stale draw is a bias and never a filter, and warns that a filter with preferences would fight the
rules for authority over what may air. A rule is a veto; a lean is a different mechanism and belongs
in the draw. Independent confirmation from a station that built both: where soft music steering and
hard exclusion live on one object, the difference has to be re-expressed as a per-object `strict`
flag, which is the same split arriving late and costing a field.

**No loose SQL exclusion in `sample`, and this reverses the obvious instinct.** Over-fetching loosely
and filtering precisely afterwards is safe only in the POSITIVE direction, where the precise pass can
still discard. In the exclude direction a loose `ilike '%rap%'` drops `Trap` in SQL and the precise
matcher never sees it to keep it: a silent over-block. Filter in TypeScript. If the pool ever starves,
the safe optimization is exact-normalised equality in SQL, which is provably a subset of what the
matcher excludes.

**One tag query, two callers.** `CandidatesRepository.tagsFor(trackIds)` is the only place the
enrichment union is written. `sample()` calls it on its own drawn ids so `CatalogSetGenerator` can
filter early, and `PickResolver.judge` calls it beside `ratingsFor` for picks it never drew. Both then
run the same `applyRules`, so the early filter and the guaranteed filter cannot disagree. Neither is
deletable because the other exists, which is the rule already written for the dislike.

**Fields: `genre` and `tag` to start.** Both read the same arrays, so both cost one matcher and no new
dependency. `genre` uses §6's refinement rule; `tag` is exact-normalised, because a free-text tag
namespace is noisy and containment there catches things nobody asked for.

**Scopes: season, daypart, lineup mode, schedule slot.** §5 names the first and the third. The daypart
is what [track-lyrics.md](track-lyrics.md) needs ("nothing explicit before nine") and §5 does not
list it; `readClock` in `clock.bands.ts` already returns a zoned hour and minute. The slot becomes
real once the daypart schedule lands. An empty scope list means "every one", so an unscoped rule needs
no null branch.

## Genre matching is one-directional, and the direction is the whole of it

From §6, and it is the part that is expensive to get wrong later. A tag may REFINE a target and may
never broaden it, and containment must be word-boundary aligned:

| target | tag | |
| --- | --- | --- |
| `Punk` | `Punk Rock` | matches, refines |
| `R&B` | `Contemporary R&B` | matches, refines |
| `Pop Punk` | `Pop` | no: broader than asked |
| `Rap` | `Trap` | no: not a word boundary |

Normalisation throws the separators away, so the boundary information has to be carried separately:
record, per normalised character, whether it opens or closes a word in the ORIGINAL string, and
require the target's occurrence to align to both. The failure the boundary rule prevents is measured
elsewhere and is not hypothetical: unbounded substrings pull `Trap` into a `Rap` filter, and a filter
that merely CONTAINS the target lets a strict request fill with anything tagged plain `Pop`.

## The phases

1. **`genre.match.ts`**, pure, with the table above as its test. No consumers.
2. **`block.rules.ts`**, pure: `compileRules` (normalise once per mutation), `inSeason` (month/day
   keys, `from <= to` a closed interval and `from > to` wrapping the year end), `ruleActive`,
   `ruleMatches`, `blockedBy` naming the rule that matched. The evaluation context is computed once
   per judge call and never per candidate. Export `readClock` from `clock.bands.ts` rather than
   writing a third `Intl.formatToParts`; there are already two. No consumers.
3. **`deadair.block_rules`**, plus contract, repository, service and module. `station_key` from the
   first migration, per [multi-station.md](multi-station.md). Seeds nothing: an empty table is a
   coherent state. Unread.
4. **`tagsFor`, `RotationCandidate.tags`, and `sample()` attaching them**, plus
   `scripts/block.rules.smoke.ts` following `rating.smoke.ts` and `advisory.smoke.ts`, because the
   interesting half is SQL. Unjudged.
5. **Wire `PickResolver`.** `applyRules` gains the compiled rules, applied FIRST beside
   `rejectDisliked` and for the same reason: absolute, cheapest, and not disable-able by a lineup, so
   it must not live on `ResolvedRules` where `NO_RULES` would zero it. This is where it starts
   working.
6. **Narrow `LibrarySearchTool`**: over-fetch roughly three times `MAX_RESULTS`, filter, slice back.
   The over-fetch is required rather than tidy, since a model shown too few rows pads its answer with
   repeats and `CatalogSetGenerator` quietly fills the hour.
7. **A `/rules` console page**, mirroring `/personas`.

## Out of scope, and why

**`mood` and `playlist` fields.** Moods want [station-moment.md](station-moment.md)'s table, which
does not exist; playlist membership wants member sets resolved and cached before matching can stay
synchronous.

**Era rules.** §6's era half has to land first: an album's `year` is the year of THAT release, so a
compilation reports its reissue date and a naive `tracks.year` rule puts every track on it in the
wrong decade. Whatever precedence the SQL uses and whatever precedence the JS uses have to be the
same precedence, or a rule and a badge will disagree about one record.

**Lyric-derived fields** (subject, season, explicitness, language). [track-lyrics.md](track-lyrics.md)
names this table as their first consumer, and says why that is the honest first consumer rather than
mood steering: a predicate is checkable and a mood is a matter of taste. One trap recorded there: a
lyric-derived explicitness judgement is a weaker second answer and must be its own field rather than
written over `track_sources.advisory`, or the station starts disagreeing with its provider about one
record with no way to tell which claim it holds.

**The freshness bias**, which is §5's own bubble section and is deliberately a different mechanism.

## Related

- [station-intelligence.md](station-intelligence.md) §5 for the original design and §6 for the genre
  and era rules this depends on.
- [track-lyrics.md](track-lyrics.md), which is waiting on this table.
- [station-moment.md](station-moment.md) for the mood vocabulary a `mood` field would need.
- [multi-station.md](multi-station.md) for why `station_key` is on the first migration.
