# A model names a record correctly and the station cannot find it

**Written:** 2026-08-15, out of the log of that evening's broadcast, in the pass that fixed the
rotation keying beside it (`9014deb`, `a41fd3a`).
**State of the tree:** `PickResolver.identify` matches a pick against the catalog, then falls to
`ProviderTrackLookup.find`, which is STRICT: `normalizeKey(track.title)` and
`normalizeKey(track.artists[0])` must both match the pick exactly. Anything else is refused, the pick
is dropped, and the running order comes up short by one.

## What was measured

One refill, 2026-08-15 20:27, `brief=rap hits across the decades`, `asked=15 named=24 resolved=11`.
Ten picks were dropped at `identify`, and **eight of the ten had a credit line in the artist field**:

```
Dr. Dre featuring Snoop Dogg — Nuthin' but a G Thang
Notorious B.I.G. featuring Puff Daddy & Mase — Mo Money Mo Problems
Kanye West featuring Jamie Foxx — Gold Digger
Kanye West featuring T-Pain — All Falls Down
Dr. Dre featuring Snoop Dogg — The Next Episode
Lil Nas X featuring Jack Harlow — Industry Baby
Cardi B featuring Megan Thee Stallion — WAP
Cardi B featuring Bad Bunny & J Balvin — I Like It
```

Every plain credit in the same answer resolved and was ingested (`Kurtis Blow — The Breaks`,
`50 Cent — In Da Club`, `Kendrick Lamar — Alright`, …). The provider search is not what failed: the
query is `` `${artist} ${title}` `` and Spotify's search is fuzzy enough to return the right record.
It dies on the line after, `provider.track.lookup.ts:102`, where the returned `artists[0]` is
`"Dr. Dre"` and the pick wants `"dr dre featuring snoop dogg"`. The record was found and then thrown
away by the comparison.

The two remaining drops — `Sugarhill Gang — Rapper's Delight` and `Wu-Tang Clan — C.R.E.A.M.` — are
ordinary lead credits that should have matched and did not. Nothing in the log says why; see phase 1.

## Half of the cause is already gone

The model was not shown that shape by the search tools, which answer with the lead artist only. It
was shown it by the station's own prompt. `describeAvoided` reverses a `songKey` back into prose, and
those keys were built from `RundownTrack.artists` — a display credit in one element for everything a
generator resolved — so the avoid list read:

```
- "shake that" by eminem nate dogg
- "big pimpin" by jay z ugk
- "shit hits the fan" by obie trice dr dre
```

That was the keying bug, and it is fixed: identity now rides on `RundownTrack.artist`, the lead, and
the avoid list renders one act per line. **Re-measure before building anything below.** A model that
is no longer shown glued credits may stop writing them, and the residue would then be a much smaller
problem than the eight-in-ten above.

## What must not be done

**Do not loosen the comparison.** The strictness is argued at the head of `provider.track.lookup.ts`
and the argument holds: a near-miss here does not error, it airs the wrong record while the console
says otherwise, and nobody watching would know. A similarity threshold, a token overlap or a
`LIKE '%…%'` is the wrong fix at the wrong end. The pick's artist field is what is malformed — it
holds a display credit where an identity is expected — so it is the pick that gets repaired, before
either rung sees it.

## Phase 1 — say what was rejected, and why

Cheapest, no behaviour change, and it is the prerequisite for judging the rest. On a strict miss,
`ProviderTrackLookup.find` today logs `no provider has a record that was chosen` and discards every
candidate it refused. Log the top few instead: what was asked for, and what came back with its
normalized forms beside it.

That turns three unanswerable questions into readings:

- how often a miss is a credit line, versus a definite article (`The Notorious B.I.G.` against
  `Notorious B.I.G.`, which `normalizeKey` keeps apart deliberately and correctly), versus a title
  suffix the model did not write (`C.R.E.A.M. (Cash Rules Everything Around Me)`);
- whether the provider returned the record at all, which is the one case where nothing can be done
  and the current log line is already the right one;
- whether the fix below is worth its risk, measured rather than assumed.

It belongs at `debug`, and it must summarize rather than quote a provider's payload — the same rule
`ActivityRecorder` holds.

## Phase 2 — take the lead off the front of a credit line

One normalization of `TrackPick.artist`, applied **once at the top of the loop in
`PickResolver.identify`**, before rung 1. Not inside the lookup, and not as a retry: three things
read that field — `candidates.findByName`, `lookup.find`, and the `songKey`/`artistKey` the rules are
judged on — and a pick repaired for only the second one enters the rules with a key no history row
can match. That is the bug that was just fixed; do not reintroduce it one layer down.

**The joiner list is conservative and the reason is asymmetric.** Split on a word that only ever
joins a guest credit, and take everything after it:

```
feat. / feat / ft. / ft / featuring / with / vs. / vs / x
```

**`&` and `,` are deliberately NOT on that list.** Splitting on them turns "Earth, Wind & Fire" into
"Earth" and "Crosby, Stills & Nash" into "Crosby", which is exactly the wrong-merge failure
`catalog.keys.ts` argues against at length: failing to match two spellings of one name costs a
dropped pick, and wrongly matching two different names airs the wrong record and nothing detects it.
Guess toward keeping things apart. The same caution rules out `x` if phase 1 shows it appearing
inside real names.

Match the joiner as a whole word, case-insensitively, on the raw string before `normalizeKey` — the
normalizer strips the punctuation that makes `feat.` recognisable.

**What it recovers, on the batch above:** seven of the eight. `Notorious B.I.G. featuring Puff Daddy
& Mase` still fails, because the credit is `The Notorious B.I.G.` and the definite article is a
different key by design. So the expected effect on that refill is 24 named → 21 identified, not 24.
Anyone claiming more has not counted the article case.

## Phase 3 — only if phase 1 says so

Two candidate normalizations, both riskier than phase 2 and neither worth building on a guess:

- **The definite article.** `The Beatles` and `Beatles` are different keys today, deliberately.
  Folding them at the LOOKUP only — not in `normalizeKey`, which the catalog's uniqueness depends
  on — would recover the `The Notorious B.I.G.` case. It is a tie-break-shaped change: accept an
  article-only difference when nothing else matched.
- **The parenthetical title tail.** `Yeah!` against `Yeah! (feat. Lil Jon & Ludacris)`. Note the
  resolver no longer mis-KEYS this case (the row's own title is what identity comes from now), but
  the lookup still refuses the match, so the record is never found in the first place.

Both are one-sided: they may only ever be tried after an exact match has failed, and a match found
that way should be logged, because the first wrong record it airs is the evidence that the fold was
too generous.

## What this is not

**Not a reason to make the model search more.** It named 24 records off ONE search, which is its own
problem and is `station-intelligence.md`'s. Even a model that searched perfectly is allowed to name a
record from memory — `set.prompt.ts` invites it to, because that is what naming records the library
has never held is FOR — so this path has to work for names no search returned.

**Not a change to `normalizeKey`.** `deadair.artists.artist_key` is `not null unique` and the ingest
resolver leans on it; a looser normalizer merges artists permanently and nothing notices.
