# Deferred: a timbral axis measured from the audio, and the map it would make worth drawing

**Written:** 2026-08-28, promoted out of [comparable-stations.md](comparable-stations.md), where it
was ranked 7th — the largest item on that list and the only one that unblocks a file currently marked
blocked. It had no file of its own, which for the biggest deferred thing in the directory is the
wrong way round.

**It is the answer to a question `station-moment.md` gives up on.** That file says mood-biased
selection is blocked on data nobody has: `EnrichedTrack.moods` exists in the plugin SDK
(`capabilities/enrichment.ts:150`), nothing fills it, and the MusicBrainz plugin explicitly declines
to. The proposed source is tags, which makes a library only as steerable as somebody else's
folksonomy — and on a library of records nobody tagged, that is not steerable at all.

The other implementation gets it from the **audio**: a joint text-and-audio embedding per record,
scored against a mood vocabulary written in words, plus nearest-neighbour lookup in the same space.
That is a real answer to "nothing populates it", because it needs no tags and no upstream, and it
gives the station a timbral axis it has nowhere else.

## The calibration trap, which is measured and is the reason this is written down

**Similarity scores from that kind of model are not comparable across different prompts.** On an
11k-track library that is not this one, scoring every track against every mood and taking the top
scores per track produced `energetic` on **61.7%** of the library and `rainy` on **43.5%**, against
`calm` at **0.9%** and `spiritual` at **0.2%**. Ranking raw scores ranks the PROMPTS, not the tracks.

The fix is a per-mood baseline over the whole library — mean and standard deviation — and then
ranking on the z axis, with the margin expressed in standard deviations rather than in raw score.
Two second-order details came out of running it, both of which look like polish and are not:

- **The minimum sample size is applied per mood, by pruning that mood**, never by gating the whole
  pass on the largest one. Gating reproduces the original bug one mood at a time: a thin new mood
  beside a fat old one wins every record.
- **Ambiguity returns null, never a middle bucket.** Bucketing an unclear result to "medium" replaces
  one guess with another and then calls it evidence. Null leaves the existing value alone, so
  mistuning costs coverage instead of correctness.

**Do not start this without the calibration rule.** A first pass that ships raw scores produces a
library where two thirds of everything is energetic, and the station will act on it.

## What it costs here, counted before anyone starts

- **There is no vector column and no pgvector.** Nothing in `apps/api/data/migrations` declares
  either. That is a migration and an extension, and the extension is an operator's problem on every
  install rather than only on this one — which matters more since the repository is meant to ship.
- **The sidecar grows a second model**, which puts it straight into
  [`docs/decisions/analysis-licensing.md`](../decisions/analysis-licensing.md). The licence that
  matters there is the **weights'**, and it is not in the package metadata. That file is not optional
  reading for this.
- **`ANALYSIS_SCHEMA_VERSION` absorbs the output shape for free.** `track_analysis.data` is jsonb
  with a version, and `0005_music.sql` says in as many words that this is what lets a deferred layer
  land with no schema change. The EMBEDDING itself is the part that wants a column, because a blob in
  jsonb is not a thing anybody can search.

**And one rule that has to be right on the first pass, because it is invisible afterwards: the
tagger's own output must never be part of what gets embedded.** The labels are derived from the
vectors, so feeding them back is circular, and the symptom is a library that agrees with itself more
every time it is re-measured.

## The map is downstream of this and is not a separate item

The other station draws a full-screen map of every measured record, placed by genre and lit by
energy. **Do not build the map first: it has nothing to draw.** What makes one worth having here is
the same thing that makes the calibration trap visible — a mood that took 61.7% of a library is a
number in a report and an obvious stain on a map, and recolouring by CONFIDENCE rather than by label
is the same argument the trace surface makes for a budget: it is hard to argue about a threshold
without seeing what it did.

## What this unblocks, and what it does not

It unblocks [station-moment.md](station-moment.md), which is the only file in this directory whose
status is "blocked on data nobody has".

It does not unblock the beat layer, which is a different measurement with a different model and is in
[track-analysis.md](track-analysis.md). The two share the sidecar and nothing else, though they share
one operational note: see that file on a long-running Python process's resident memory.
