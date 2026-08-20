# Why this record followed that one

**Written:** 2026-08-19, out of a review of two other operator consoles for a station like this one.
**State of the tree:** `SetGeneratorChain.announce` writes one `station_events` row per refill saying
who named how many (`director`, `set.generated`), with `data: { asked, chosen, named, declined }`.
`ModelSetGenerator` asks a model for picks and keeps the names; nothing asks it why, and nothing
stores an answer if it did. `play_history` records what aired. The activity feed reads all of it and
can say what happened and never why.

## What is missing, and what it is worth

The one thing another station's console does that this one has no way to do is print the DJ's
reasoning beside the records, as a booth log:

```
14:46:22  PICK   Exact key match (7A→7A), near-identical pace, low energy, reflective mood — a
                 seamless step from the arpeggiated current track into a contemplative interlude,
                 breaking the run of one genre while staying in the show's lane.
14:46:22  PLAY   "A Street I Know" — Skrillex & Eli Keszler
```

That is not decoration. Three things this repo already argues become checkable with it:

- **A brief that is being followed, or not.** `station_lineup.brief` reaches the model in the user
  turn and nothing afterwards reports whether the answer honoured it. A refill that quietly drifted
  and one that was faithful look identical on the feed today.
- **The chain topping up.** `SetGeneratorChain` reports that the floor finished a batch the model
  started, which is the fact `announce` exists for — and an operator reading it cannot tell a model
  that ran out of ideas from one that was asked for the wrong thing.
- **`rotation.briefOnly` costing a refill records.** The setting's whole price is made visible in one
  sentence today. A per-pick reason is what would say which records it would otherwise have taken.

## Why it is not a console change

Every part of this is upstream of a page.

**The generator has to be asked.** `SetGenerator.generate` answers `TrackPick[]`, which is a name and
an artist. A reason means a field on the pick, which means the model is asked for one — more tokens
per refill on a self-hosted model that is already the slow part of a refill, and a second thing for
`readAnswer`-style validation to be tolerant about. It is not free and the file should say what it
costs before anyone spends it.

**The floor has no reason and must not invent one.** `CatalogSetGenerator` is a weighted draw. Its
honest answer is the weights that moved — rating, recency, artist spacing — which is a different KIND
of sentence from a model's, and the two must not be presented as though one wrote them both. The
station's own rule for this is already written down in `activity.feed.ts`: the sentences are composed
outside the SQL, by app code, and never quoted from somewhere else. A floor pick with a fabricated
rationale would be the first line on that feed nobody could trust.

**There is nowhere to put it.** `play_history` is what aired and is read by the repeat window and the
artist cooldown; widening it for a string no rotation rule reads would put narration on the hot path
of every selection query. `station_events.data` already carries the refill's own jsonb and could
carry an array — but a reason belongs to a PICK, and a pick is not yet a row anywhere between being
named and being aired.

## The shape, if it is built

Three phases, in this order, and the first is worth having alone.

1. **A reason on the pick, kept in memory and reported once.** `TrackPick.reason?`, filled by
   `ModelSetGenerator` alone, and `announce` grows a sample of them on the `set.generated` row's
   `data`. No migration, no new table, and the feed can draw it immediately. It answers "what was
   this refill thinking" and cannot answer "why did this record follow that one", because a batch is
   named before the order is decided.
2. **The reason survives to air.** Which is a column, and the question this file exists to make
   somebody answer: on `station_lineup`'s item (jsonb, so no migration, and it dies with the
   broadcast) or on a new table keyed by broadcast and song key (durable, and a second writer of
   something `play_history` half-covers). The lineup is the cheaper and more honest one — a reason is
   about a running order, and a running order is consumed.
3. **The pairing.** "Why this after that" is a judgement about two adjacent records and is not what
   the model was asked in either phase above: it named a set, and the order came later. Getting it
   properly means asking at SEQUENCING time rather than at selection time, which is a different call
   into a model on the boundary path, where `BUDGET_MS` and the one model slot already decide what is
   affordable. This is the phase most likely to be refused; the first two do not depend on it.

## What must not happen

- **No second sentence about a fact the station already words.** The feed's rule holds: one writer per
  fact.
- **No reason on the deterministic floor.** See above. A pick with no reason reads as a pick with no
  reason, which is true.
- **Not on the hot path.** Nothing about a rationale may be read to decide anything — not by
  `PickResolver`, not by the rules, not by the repeat window. It is reported and never enforced, the
  same standing `StationTasteTool` has.

## Related

`docs/todo/station-intelligence.md` for the layer this sits in, `apps/api/src/modules/director/set.generator.chain.ts`
for what `announce` says today, and `apps/api/src/modules/activity/activity.feed.ts` for where a
sentence about it would be composed.
