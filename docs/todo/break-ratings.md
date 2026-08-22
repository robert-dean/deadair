# The station's own words get an opinion

**Written:** 2026-08-22, out of "can the personas learn, self-reflect, improve?".
**State of the tree:** nothing here exists. Everything it attaches to does: `deadair.script_history`
(migration 0008), the `/scripts` console page, `CharacterFault`, and the catalog's own three-level
rating, which is the shape this borrows and the argument this is measured against.

---

## The problem, which is that the only judge is the station itself

The station records a great deal about what it said and nothing about whether it was any good.

`deadair.script_history` is one row per write ATTEMPT with the writer, the model, the template, the
neighbours, the token counts and the duration. `CharacterFault`
([persona.sheet.ts](../../apps/api/src/modules/personas/persona.sheet.ts)) is a closed vocabulary of
four ways a script is not the character speaking, and `BreakPromptShape.mustNameRecord` adds a fifth.
So "this persona fell to the floor 40% of the time and 31 of those were `out-of-character`" is
already a query rather than a feature.

**That is a rubric, not an opinion, and optimising against it is a trap the tree already documents
one level down.** `overusedWords` asks and never refuses, on the stated grounds that `dictionMarkers`
are named in the prompt and counted in the answer, so the cheapest way to pass the character check is
to say the marker list again — a check that declined over it would be refusing the character for
being itself. Any pass that tuned a sheet to reduce declines would be steering toward exactly that:
the decline rate improves, and the station gets worse.

The other candidate signals do not exist and cannot be manufactured:

- **The audience is a count.** `AudienceWatch` polls Icecast and follows `/admin/eventfeed`, and
  neither says anything about a sentence. A listener who leaves during a break and a listener whose
  train went into a tunnel are the same number.
- **The operator's recorded opinions are all about music.** `artists`, `albums` and `tracks` each
  carry a rating and `CandidatesRepository.effectiveRating` collapses the three. Nothing anywhere
  holds an opinion about a break.

So the missing piece is small and specific: **a place for the operator to say whether a break
landed**, and it is worth building before anything tries to learn from the corpus.

## The shape

**A separate table, not a column on `script_history`.** That table is deliberately append-only with
no `updated_at` and no trigger, on the stated grounds that a row is a fact about a moment, that a
column saying when it last changed could only ever repeat `created_at`, and that "having one invites
somebody to make it lie". A rating is an edit to a row that must not take edits.

```
deadair.script_ratings
  created_at, updated_at, station_key
  script_id uuid not null references deadair.script_history (id) on delete cascade
  rating    smallint not null check (rating in (-1, 0, 1))
  actor_id  uuid                       -- who said so, as the operator surfaces already stamp
  primary key (station_key, script_id)
```

`on delete cascade` rather than `set null` here, unlike everything else that points at that table: a
rating with no script is not a fact that outlives its subject, it is an orphan. The nightly sweep
(`render.prune_script_history`, `render.scriptHistoryDays`) takes both, which is the right answer as
long as anything reading ratings reads them inside the retention window — and everything below does.

**The two spellings are the catalog's, exactly.** The wire says `liked` / `neutral` / `disliked` and
the column says `1` / `0` / `-1`, mapped in one file the way
[catalog/rating.ts](../../apps/api/src/modules/catalog/rating.ts) already does it, because the
ordering is what the SQL wants and nothing outside the database should read an opinion as a number.
Do not invent a second vocabulary.

**It is on the ATTEMPT and not on the persona, the segment or the template.** One row per attempt
means the FLOOR's phrasing can be rated too, which is the only way an operator learns which of
`rotation.breakTemplates` actually land and which of their own lines they wince at. Every narrower
verdict — this persona, this template, this writer, this model — is a `group by` over rows that
already carry all four. A rating column on `deadair.personas` would answer one of those questions and
foreclose the rest.

**Neutral is a real state and not an absence**, on the catalog's own rule: rating something back to
nothing is a thing an operator does, and it must be distinguishable from never having listened.

## Where it is written

Two surfaces, both writing the same row, and neither is new page work:

- **`/scripts`** already exists and paginates the whole history newest first
  ([scripts.tsx](../../apps/web/src/routes/scripts.tsx), `GET /scripts` in
  [render.ck](../../apps/api/data/contracts/render/render.ck)). This is the review surface: an evening
  spent reading back what the station said. The page already filters by kind, writer, outcome and
  segment, so `rating` joins that set.
- **The on-air panel** is where rating in the moment belongs, because the judgement worth having is
  the one made while the break is still in the room. It needs the id of the attempt that produced
  what is playing, which the segment already reaches through
  `ScriptHistoryPageQuery.segmentId`.

The route is a `PUT /scripts/{id}/rating` under `platform.manage`, mirroring the three catalog rating
verbs including their override of the file's read floor: reading what the station wrote is a view,
having an opinion about it is an operator action.

## What reads it, in the order the value arrives

**1. The persona notebook's distil selection.** The notebook pass
([personas.md](personas.md) §2) reads a character's own written scripts and distils notes it will
build on later. A note distilled from a break the operator thumbed down is the station reinforcing
exactly what did not work. The predicate is one clause — `and rating is distinct from -1` — and the
pass carries a comment naming it until this table exists.

**2. A persona performance read.** The decline rate by fault kind beside the liked and disliked share,
per persona and per kind. This is where a sheet actually gets tuned by hand, and it needs no model:
it is a page over two tables. It also answers the question the rubric cannot — whether the breaks that
PASSED every check were any good.

**3. The deferred half: proposed sheet edits.** A rated corpus is what makes "this character would be
better if `diction` said X" a claim with evidence rather than a guess. Three rules, and each has a
precedent in the tree:

- **It proposes and never writes.** `deadair.pronunciations` makes `rejected` a state rather than a
  deletion for exactly this reason, and `CONFIDENCE_BAR` is the line between saying a thing unasked
  and offering it. A persona is the operator's voice; a station that quietly rewrote its own character
  overnight is a change they can neither see nor undo.
- **Every proposal carries its evidence**, on `deadair.facts`' rule that a claim with no source must
  not be expressible: a proposed diction marker arrives attached to the rated rows that motivated it.
- **It is judged by REHEARSAL, not by a diff.** `PersonaRehearsalService` runs against a deliberately
  FIXED pair of invented records so two readings are comparable, which is precisely an A/B harness for
  a candidate sheet against the current one. It exists and nothing uses it this way.

## What this does not cover, deliberately

- **Listener feedback.** There is none. The mount is a mount, `AUDIENCE_LINGER_MS` is a lease, and
  nothing about a connection is an opinion. Do not build an inference from listener churn: a break is
  seconds long and a departure has a dozen causes.
- **Any path that changes a sheet without the operator accepting it.** See the three rules above.
- **Rating what the station PLAYED.** That is `artists` / `albums` / `tracks` and it is built. This is
  about the words.
- **A model rating its own breaks.** A model asked to check its own work in the same breath approves
  it, which is why `fact.model.ts`'s verification is a separate conversation that has never seen the
  article. There is no equivalent trick here, because "was that any good" has no quote to be entailed
  by. The operator is the judge or there is no judge.

## Related

[personas.md](personas.md) for the notebook this feeds and for what is left after the character sheet.
[dj-voice.md](dj-voice.md) for the writers themselves.
[fact-enrichment.md](fact-enrichment.md) for the propose-with-evidence pattern in its original home.
