# Internals: what the station plays

How records are chosen: the generator chain, the operator's opinion, the content policy, and the one
step every pick from every source passes through. The running ORDER those picks land in is
[`director.md`](director.md).

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## How a pick is made

**What the station PLAYS has several generators too, and that chain tops up rather than falling through.**
`SetGeneratorChain` is registration order as preference order, exactly like the writer registry
(`ModelSetGenerator` in front, `CatalogSetGenerator` behind it, `llm.setGenerator` off by default). The one
difference is load-bearing: a break is one sentence and is all-or-nothing, so the writer registry takes the
first answer and stops, but a set is `count` picks and a model that named six of fifteen has done most of the
job. So each binding is asked for what is still MISSING and the floor finishes the rest, which is why a
partial answer is kept rather than discarded. Songs already chosen thread down as `avoidSongKeys`; the whole
order's artists deliberately do NOT, because excluding every artist already queued starves a long rotation of
its own library. Only the artists queued inside the cooldown thread down, as `queuedArtistKeys`, and the
cooldown is what bounds that set: see "The artist cooldown holds against the queue" below.

**The floor cannot fail**, so keep it last. The ONE thing that suspends that guarantee is
`rotation.briefOnly`, off by default: with it on, a generator declaring `SetGenerator.ignoresBrief` (only
`CatalogSetGenerator` does) is not asked while a brief is in force, so a station told "flamenco guitar" runs
short rather than finishing the hour with whatever else the library holds. Three bounds make that safe to have
at all — it applies only where there IS a brief, since an unbriefed station's floor is not a mismatch but the
station itself; the similarity binding is deliberately NOT marked, because its seeds are records that actually
aired and so it draws from the brief's own results (**that argument does NOT stretch to a PERIOD**, and both
middle bindings filter on one themselves — see the period rule in `director.md`); and a refill it actually
cost records says so on the activity feed, because a station that ran dry with a full library is otherwise two
facts with nothing connecting them.

**A refill whose model goes quiet plays what its searches were FOR, and nothing else they touched.**
`ModelSetGenerator` keeps every row `search_music` answered with (`SearchedRecords`), and when the model
names nothing (a throw, a `length` finish, the refill's time running out) `rescue` spreads across those rows
one artist at a time. A search answers wider than its query, and the model reading it skips the strays, but
the rescue gives every artist in an answer a turn, so a stray is worth exactly as much as a record the model
asked for. Measured on the live station, 2026-10-11: briefed for heavy metal, gemma4 ran out of time after
seventeen on-brief searches, the library had answered `Dio` with every "Radio Edit", "Audio Remix",
"Diopter" and "Dior" it held, and the Boneyard aired Culture Beat, Pop Smoke and a run of house remixes.
So the search tool remembers each row with `matches`, whether it answered the query as whole words, and
the rescue reads only `matching()`. A row matches by its CREDITS (`artistCreditsOverlap` over the artist
and anyone featured: the query must be a whole act in the credit, which turns away "slayr" for `Slayer` and,
measured on the live station 2026-10-22, Boston 168's techno for `Boston`, which whole words had let through
twice in a rock hour; "WWE, Motörhead" still answers `Motörhead`), or, in the library, by a STYLE: the SQL's
`matchesStyle`, the genre and the tags through `regexWholeWords`, because a style search finds a record by a
tag the row itself does not carry. **Never by its title alone.** Measured on the live station, 2026-10-14:
a rock and roll hour searched `Chuck Berry` and `Little Richard`, the model went quiet, and the rescue took
in Pharrell Williams' "Chuck Berry", The Rolling Stones' "Chuck Berry Style Jam" and Eddie Murphy's stand-up
bit "Little Richard", which aired. The model reading a row can still name it by its title. A search with
no text matches every row. Nothing matching is an empty answer, and the chain carries on exactly as it
did before the rescue existed, so under `rotation.briefOnly` a short refill beats an off-brief one.

**A brief that names its acts is read in the order the station has neglected them, not the order it was written.**
A model works down a brief's list from the top, and a slow one runs out of time near it. Measured on the live
station, 2026-10-11: The Boneyard's brief names twenty-four acts, all in the library, and three refills
searched the first five, the first five again and the first seventeen; Kreator, Sodom, Cannibal Corpse,
Behemoth, Mastodon and Queensrÿche were never searched, and six acts took 39 of the show's 86 plays.
`BriefArtists` answers which library artists the brief names (`ArtistsRepository.namedIn`: `strpos` narrows,
then `hasWholeWords` case-sensitively, so "Sabbat" inside "Sabbath" and "Queen" inside "Queensrÿche" fall
away and "loud" is not an act called "Loud"), ordered by `PlayHistoryRepository.lastAiredByArtist`, never
aired first and ties in the brief's own order. Library artists found IN the brief rather than the brief
parsed, because a brief is prose and the punctuation is one operator's; an act the library has never held
is missed, and nothing downstream could look it up by name anyway. The model's user turn lists them in that
order with how long ago each aired, and is told to search them in THAT order. A read that fails lists
nothing, which is the prompt as it was. **An act the brief names only to rule out is not one of them**
(`excludedByBrief`): "Britpop, but no Oasis" used to hand Oasis to the generator below as a lead, with no
model reading the "no". A negating word opens a stretch that runs to the end of its sentence, a colon or
a turning "but"; a negating word inside a library name ("No Doubt") is not one, and an act is dropped
only when every mention of it is negated. The model still reads the brief's own prose.

**`BriefArtistSetGenerator` plays the brief's neglected acts with no model in the room, and sits AHEAD of the
model for its share.** The prompt line above only helps a model that finishes. This binding takes
`BriefArtists`' list, skips any act the cooldown holds (aired or queued inside it, or one the caller said to
avoid, since the resolver would drop its record), and asks `SimilarPicker.pickFromArtists` for the freshest
of each remaining act's provider top tracks, one per act, until it has `rotation.briefArtistMix` of the batch
(0.4). Provider top tracks rather than the library, because the neglected acts are the ones the library is
thinnest on (that day Behemoth, Morbid Angel, Mastodon and Queensrÿche held one playable record each, which
the repeat window rules out after a single airing). It is the one binding registered ahead of
`ModelSetGenerator`: behind it, it would fill only what the model left, which on a model that answers in full
is nothing, and the neglected acts would starve again. Ahead of it, the model is asked for the rest, with
these records in its avoid list, and is likelier to finish inside its time. No brief, a share of 0, a brief
naming nobody free to air, or no plugin able to name an artist's records (said once) all step aside. It does
not declare `ignoresBrief`: everything it names is in the brief.

**Under a brief that names its acts, the similarity walk seeds from the four off air longest.** It used to seed
from this broadcast's four most recent artists, which is safe (they are the brief's own results) and was a rut:
a brief read from the top airs the same few big names, so on The Boneyard the seeds were always four of the
same six and their neighbours were each other. `SimilarSetGenerator.seeds` now asks `BriefArtists` first and
walks from Kreator's and Behemoth's neighbours instead. A brief naming nobody the library holds ("Loud and
fast") keeps the broadcast-scoped seeds, and a briefed hour with no broadcast still seeds nothing.

**What the similarity sources say is kept, and filled only on demand.** `SimilarityService` held who
resembles whom in a day-long map and asked for an artist's top tracks every time, and the station
deploys itself on every push, so the map was empty several times a day. It now writes every answer to
`similarity_asks`, `similar_artists` and `artist_records` (0119) and answers from there while the answer
is under a week old (`STORED_ANSWER_TTL_MS`) and asked for at least as many; the map stays in front of the
neighbours. **Nothing walks the library to fill it**: every answer is one some caller asked for anyway, so
the store holds the artists the station actually airs and walks toward. An empty answer is kept, so an
act nobody knows is not asked about on every refill; an outage is not. A store that cannot be read or
written costs the store and never the answer.

**The store is drawn as a graph, and the drawing reads the store and nothing fresher.** `GET
/catalog/similarity` (`SimilarityGraphService`) answers the stored neighbours as DIRECTED edges, one per
`similar_artists` row, with the artists they name as nodes keyed by `normalizeKey` and joined to the catalog
by `artist_key`, so a node carries an `artistId` only when the library holds that artist. It never asks a
source: a console page must not cost a provider call per artist on the screen, and the store is exactly
what the station has acted on, so an artist nobody has looked up has no edges of its own, which is the
truth about the store rather than a gap in the answer. Without `around` it answers the best-ranked edges
of the whole store; with it, one or two steps either way from a catalog artist, both the artists it names
and the artists that name it. `library` keeps both ends in the catalog and is decided in SQL BEFORE the
limit, so a library-only graph is not the handful that survived a limit spent on strangers. **The weight
is the rank, never the source's `match`**: a Last.fm score and a Deezer one are not the same distance, so
the console's layout (`similarity.layout.ts`, `d3-force` run to rest so the picture is the same every
visit) folds A-names-B and B-names-A into one link weighted `1 / (rank + 1)` from the better of the two,
and draws a pair that names each other brighter. The edges stay directed on the wire because a reader
handed one line cannot unfold it. Two readers: the Library's Similar tab (the whole store, 600 edges at
most) and the "Sounds like" card on an artist's page (its neighbourhood).

**A brief's acts include the ones the library has never held, found among the neighbours of the ones it
has.** Measured on the live station, 2026-10-25: The Church's brief names Mayhem, Darkthrone and Emperor
and the library holds nothing by them, so `BriefArtists` never reached them. `BriefActs` asks who
resembles each library act, keeps a neighbour the brief names as whole words (`namedInBrief`, with
`excludedByBrief`'s negation, so "No Burzum" holds however often a source offers him), and keeps the three
closest other neighbours of each act as leads. It is the one fill nobody asked for first, so it fills the
store for the acts (25 records each) and the neighbours (10) at most `MAX_ASKS_PER_RUN` (16) provider
questions per refill, acts first; an answer already stored costs nothing. An act no neighbour list reaches
is still missed.

**A show prepared ahead seeds from nothing that aired.** `PrepareSlotJob` chooses a show's opening records
before it starts, while the broadcast on air is still the show before it, so "this broadcast's records" there
meant the previous show's. Measured on the live station, 2026-10-15: Banjo Breakdown was prepared at 06:57
while The Boneyard was still the broadcast, its brief named nobody the library held, and the walk seeded from
Suffocation and opened a bluegrass hour with Nile. The job now sets `SetInputs.ahead`, and under it
`SimilarSetGenerator.seeds` takes only the acts the brief names and otherwise nothing, briefed or not. The
first refill after the show opens seeds from its own records as usual.

**A pick is judged where it becomes a track, never inside the generator that named it.** A `SetGenerator` pick is a NAME, so any binding that is not the catalog draw hands over titles nothing has judged, and a dislike is an INSTRUCTION no lineup may turn off, so a generator able to route around it airs a record the operator forbade. The rules therefore run in `PickResolver.resolve(picks, rules)`, the one step every pick from every source passes through. `CatalogSetGenerator` still filters before its own draw and that is NOT redundancy: filtering early keeps the draw from spending its weight on candidates that cannot air, filtering at the resolver makes the rules true for a generator that never read the catalog, and neither is safe to delete because the other exists. `applyRules` composes the four that decide whether a candidate may air; `spaceArtists` runs last and separately, because a batch spaced before its unplayable tracks are dropped closes the gap back up and puts one artist back on its own heels. The album cap (`rotation.maxPerAlbum`, `capPerAlbum`) is one BATCH's worth of variety, same as the per-artist cap beside it. Nothing here stops the record after it from picking the same release again, which is the cross-batch seam `avoidArtistKeys` and `queuedArtistKeys` already close for artists and a release has not needed yet.

**The artist cooldown holds against the queue, not only against what aired.** `rotation.artistCooldownMinutes` (forty by default) was read from `play_history` alone, and nothing queued has aired, so it had nothing to say about the two places an artist actually came round too soon. Inside one batch the per-artist cap lets two records by one act through and `spaceArtists` only keeps them off each other's heels: `[A, X, X, B, ...]` comes out `X A X B ...`, two X records about eight minutes apart against a forty-minute setting. Across refills only the last `maxPerArtist + 1` items of the order were held back, a handful of records, so an artist six records from the end was free to be chosen again with half the cooldown still to run. Both are judged by WHEN now, from `air.estimate.ts`, which gives each queued item an estimated start and counts an unmeasured record as `NOMINAL_TRACK_MS` (four and a half minutes, the figure the break planner already spaced with, moved there so the two rules agree; deliberately not `air.clock.ts`'s zero, which is for breaks that must never land early). A refill passes `artistsQueuedWithin` the queue (`upcoming()`, or for a replan only the records the player holds) and every artist whose record starts less than the cooldown before the batch begins joins the aired ones in `filterByHistory`, through `applyRulesHoldingQueue`, in the catalog draw and again at the resolver. After `spaceArtists`, `holdArtistCooldown` walks the batch in airing order and drops a record that would start inside the cooldown of the same artist's earlier one; the oversample is what makes that good, as it is for every other drop. Start to start, which is how the history measures it. Only the spaced path: a request, a countdown and a mixed-in record keep their order and are only vetted, and a cooldown of `0` changes nothing.

**Both give way rather than starve the batch**, on `spaceArtists`' precedent of taking the head when everything left is by the artist just placed, because stalling is worse. Holding every queued artist could empty a refill on a small library, and an empty refill is a running order running down. So a queued artist is held only while there is enough else: when holding them would leave fewer than the batch asked for (`want`, the count before the oversample), their records that every other rule passes are let back in, in the order offered, and the in-batch hold keeps its earliest drops in place the same way. What it falls back to is exactly the station before this existed. An artist who has actually AIRED inside the cooldown never gives way, and neither does the tail window, which stays as the floor: at the default cooldown the queued window covers it several times over.

**The repeat window gives way too, longest off air first, and only when a batch would otherwise come back EMPTY.** `rotation.repeatWindowDays` (three by default) is library-wide and a draw is not: a period, a clean-only policy or a small library narrows what may air while three days of airplay stays three days of airplay, and once every record a narrowed draw can reach has aired inside the window each one was refused, the floor came back empty and the running order ran down, which is the floor failing in the one way this page says it cannot. `letRepeatsBackIn` (`rotation.rules.ts`) re-judges the candidates with the window's own songs taken out of `recent` and admits those the window ALONE refused, oldest `lastAiredSince` first, until the batch reaches `want`, and only when nothing else survived the rules: a dislike, a never-play rule, an artist inside the cooldown, the per-artist cap and a song the running order already holds all still refuse. Oldest first because the choice is no longer between a fresh record and a repeat but between repeats. **Empty, not short**, because short is the ordinary case: it used to give way whenever a batch fell short of `want`, and on 2026-10-20 a refill that wanted fifteen and kept fourteen let "Pride and Joy" back in to make up the number an hour after it aired, with eight records still queued. A batch that brings anything keeps the order growing and the director asks again when it runs low; a batch the window empties adds nothing and the order runs dry, which is the failure this exists for. It runs in BOTH places the window is judged, the floor's draw and `PickResolver`, for `era.watch.ts`'s reason: a floor that let a repeat back in would hand the resolver a pick the resolver then drops. The ages are read only when a batch is empty and the window holds anything, so an ordinary refill pays no extra round trip, and a failed read costs the give-way and never the batch. `RepeatWatch` says so on the activity feed (`rotation.repeatWindowGaveWay`), edge-triggered like `EraWatch` and told by `PickResolver` alone, since the resolver is what decides what airs and a repeat the floor let back in can still be dropped there for a fresh record, because a station repeating itself to stay on air has a fix (widen what the broadcast plays or shorten the window) that nobody makes without being told.

**A joined lead credit counts against the spacing of every act inside it, and against nothing else.** On the live station 28 of 2,050 plays in thirty days (2026-10) aired under a lead that names more than one act, "Yusuf / Cat Stevens", "M / Robin Scott", "Pixies • Black Francis": a provider that has one artist string per song (Navidrome's `song.artist`) or a release that credits a duo as one name hands the whole line over as the lead. Its `artistKey` is `yusuf cat stevens`, which no rule ever equated with `cat stevens`, so the cooldown, the queued-artist hold, `spaceArtists`, `holdArtistCooldown`, the similar walk's one-per-artist and the model generator's own spacing all let the two follow each other. `rotation.keys.ts` now has `artistCreditsOverlap`: two credits are one act when one, WHOLE, is a run of whole acts inside the other, and an act boundary is a run of non-word characters holding both a space and a joining mark judged by character class (dash, other punctuation, maths and other symbols, less sentence terminals and quotes), never a list of separators, because the separators are whatever a tagger chose. That is what keeps the guard rails: "Air" is not inside "Air Supply" (a space with no mark), "Jay" not inside "Jay-Z" (a mark with no space), "Sly & Robbie" not inside "Sly & the Family Stone" (sharing a first act is not containing one). The joins survive as a `creditKey` (acts joined by ` / `, equal to the `artistKey` for any credit naming one act) on `RotationCandidate`, and a spacing SET holds each lead's `spacingKeys`, the key plus the credit key for a joined one, asked through `isArtistHeld`. The history half reads `artist`, the lead as written, beside `artist_key` in the cooldown's own window read (`artistKeysSince`) and compares in memory: a cooldown is a few dozen rows, and a pattern match against the index would be slower and could not see the joins anyway, since the key has lost them. **Spacing only, on purpose**: the identity stays the lead's key, so a dislike, a veto, a never-play rule, the repeat window and the per-artist cap match exactly what they always did, because a refusal must never reach further than what the operator named. The rare false match ("Earth" inside "Earth, Wind & Fire", "Tyler" inside "Tyler, The Creator") costs a record held a little longer, and every spacing rule gives way rather than starving a batch. Reading the OpenSubsonic `artists[]` list instead was considered and not done: it would move the lead of every joined credit on the next sync (`ingestTrack` finds a track by lead artist and title, so it would insert a new track and album and move the binding onto it, leaving the old row's ratings behind), which needs a migration story first.

**A tail act the library knows counts for spacing too, wherever it stands in a credit.** Containment cannot see a shared act that sits in second place: "Ada Vale & Mira Stone", "Mira Stone & Theo Park" and "Juno Reyes & Mira Stone" are none of them inside another, so the cooldown and `spaceArtists` let them air back to back. Splitting every credit and holding every act would undo the guard rail above ("Sly & Robbie" would hold "Sly & the Family Stone"), so the library decides: an act inside a joined credit counts when `deadair.artists` holds it as an act of its own, an unmerged row with that key, meaning some credit leads with it. Mira Stone also leads credits alone, and Sly leads none. `CandidatesRepository.knownActs` asks about the acts inside the joined credits a refill touches, and only when there are any, which is rarely (28 of 2,050 plays above). The floor and `PickResolver` then add each known act to the cooldown and queued sets as a plain key (`withKnownActs`), so `isArtistHeld`'s own overlap finds it inside a candidate's credit, and stamp the candidates with their known `acts` so `sameAct` keeps two credits naming one off each other's heels. Spacing only, exactly as above: the identity, the dislikes, the never-play rules, the repeat window and the per-artist cap stay on the lead's key. A failed read spaces as before.

**Smart shuffle is a lean on the draw, never a filter, and it is keyed on the song.** The repeat window and the artist cooldown are filters, and a filter has nothing to say about the far side of itself: past the window, a record aired four days ago and one never aired were drawn with identical probability, which is the bubble [station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §5 names. `rotation.smartShuffle` (on by default) stamps each sampled candidate with a `freshness` from `0` (just aired) to `1` (a `rotation.smartShuffleDays` horizon ago, a fortnight by default, or never), read from `PlayHistoryRepository.lastAiredSince` grouped by `song_key`, so a discovered copy of a record that aired yesterday is exactly as stale as the copy that aired. `weightOf` multiplies it in beside the like-doubling, from `FRESH_FLOOR` (a quarter) up to full weight. **Never zero**, because a weight of nothing is a second repeat window nobody set, and a library of forty records must still play all forty. Three limits worth knowing before anyone extends it. It chooses only among what `CandidatesRepository.sample` drew, which is enough because the sample is random; if it ever has to hold for the whole library in one batch, the fix is ordering the SQL by a randomised function of age rather than raising the ceiling. It is bounded by the history's 120-day retention, which is why the horizon's ceiling is that figure. And a generator that NAMES records cannot be weighted, only judged, so the lean reaches the named sources where they choose rather than at the resolver. `SimilarSetGenerator` takes the freshest of each neighbour's few top tracks, ties to the source's own ranking, instead of always the first: a neighbour's first track is the same record every time that neighbour comes up, and on the live station the fortnight's most-aired records (2026-09-12) were exactly those canonical hits, five to seven airings each. `ModelSetGenerator` cannot be leaned at all, since the model does the choosing, so it is TOLD instead: the refill reads the same history into the scoped `AiredRecords` and `MusicSearchTool` marks each row with `airedDaysAgo`, the shape `queued` already has and for the same reason (a fact the host holds must not become a question the model spends a step on). Information, never a veto: a narrow brief may need the record that aired yesterday, and refusing it is the repeat window's job. Off asks the history for zero days, which runs no query and restores the old draw, the old walk and the old search rows exactly.

**A liked ARTIST coming back after weeks away is a third lean, and it reads the operator's rating, never the
history's counts.** Smart shuffle is keyed on the song, so it says a record has rested and nothing about the
act behind it: an artist the operator liked could go a month without airing while every one of their records
read as merely fresh. `rotation.artistReturn` (on by default, `rediscover.ts`) stamps `returning` on a sampled
record whose ARTIST is liked (`artists.rating`, read beside the effective rating as `CandidateTrack.artistLiked`,
because a like at any level carries that one) and who has not aired within `rotation.artistReturnDays` (three
weeks), and `weightOf` multiplies it by `RETURN_LEAN`, half again on top of the like. "Not aired" is the artist
cooldown's own read, `artistKeysSince`, asked for the window in minutes, so there is no second query shape; and
because that read answers empty when asked for zero, the generator stamps nothing at all with the switch off
rather than reading the empty set as "nobody aired". Liked by the operator and never "aired a lot", for the
reason #37 gives against ranking by play counts.

**An album track nobody has heard here, off an album the operator likes, is a fourth lean: the deep cut.**
`rotation.deepCuts` (on) stamps `deepCut` on a sampled record that has a `track_number`, is not liked for
itself (a record liked for itself is a favourite, which the like already draws), sits on an album that
`CandidatesRepository.albumsWithLikes` says the operator likes (the album rated, or any live record on it
rated), and whose song key has not aired in the whole retention; `weightOf` multiplies it by `DEEP_CUT_LEAN`.
Three decisions. **No track number, no deep cut**: without its place on the album nothing says it is not the
single. **"Never aired" reads the retention**, which means the smart shuffle's `lastAiredSince` is asked for
120 days whenever this is on, and that is free for the shuffle: an airing older than its horizon weighs
exactly like an absent one, so one read serves both (`historyDaysForLeans`). **Likes again, never plays**,
and the album lookup is asked only about records that could qualify, over an index added for it
(`tracks_album_idx`, 0082), with a failed read costing the lean and never the batch.

**An operator's Skip is a lean against the record for a fortnight, which is the space between a like and a
dislike that nothing filled.** `play_history` is written when a record starts and never updated, so a record cut
after ten seconds read exactly like one heard to the end, and the clearest opinion the station gets short of a
rating was thrown away. `deadair.track_skips` (0083) keeps it: `PlayoutService.skip`, which the console, the MCP
tool and the chat command all reach, writes the record's song and artist keys (off the lead, as the history is),
how far in the cut came and who pressed it. **Only that method writes**, because the other cuts are not verdicts:
a dislike's (`vetoDisliked`), a changeover's overrun and a skip-to all go to `PlayoutPusher.skipCurrent`
directly, and a break or a programme is never recorded. `rotation.skipLean` (on, `skip.lean.ts`) reads
`lastSkippedSince(rotation.skipLeanDays)` per refill and stamps `skippedFor`, how far the record has recovered
on the smart shuffle's own ramp (`freshnessOf`), and `weightOf` multiplies `SKIP_FLOOR` (a quarter) rising to
`1`. **Never zero**, for smart shuffle's reason: a refusal is a dislike's job, and an operator who skipped a
record in a bad mood has not banned it. Catalog draw only, and a failed read costs the lean and never the
batch.

**A broadcast's mood is a second lean on the draw, never a filter, and it is the factor a like gets.**
With a mood on the running order (`station_lineup.mood`, from a schedule slot or `PutOnAirInput.mood`),
`CatalogSetGenerator` reads the judged distributions for what it sampled (`LyricLabelsRepository.moodsForTracks`,
one query) and stamps `moodFit` on each record giving the mood at least `MOOD_FIT_SHARE` of its weight;
`weightOf` doubles those. Everything else keeps the weight it had: a mismatch, a record never judged, one
the model could not place. That asymmetry is the point. A comparable implementation measured picking by a
mood read off lyrics against a few hundred hand-labelled records and was right about half the time, against
a third for picking at random: a real signal and a poor filter. So a fitting record is made more likely,
a library of forty still airs all forty, and a failed read of the moods costs the lean and never the
batch. Only the floor reads it, for the period's reason (a stored number, not prose), and there is no
switch of its own: naming a mood IS the switch. `MOOD_FIT_SHARE` is an unfitted third and says so; fitting
it needs records labelled by hand on this station.

**A mood a broadcast avoids is the same lean the other way up, and for the same reason it is not a
never-play rule.** `SetInputs.avoidMoods` stamps `moodAvoid` on a sampled record judged to give any of them
`MOOD_FIT_SHARE`, and `weightOf` multiplies it by `MOOD_AVOID`, a half: the inverse of the boost, so a record
in both the mood leant into and an avoided one weighs what it did. Never zero. A judgement right about half
the time would refuse as many records wrongly as rightly, with nothing on air to say so, and a refusal is
`block_rules`' job, which reads a provider's tags rather than a model's reading of the lyrics. One read of
the labels serves both halves.

**Several similarity sources are asked in an order the operator sets, and the order matters to two of the three questions rather than all three.** `SimilarityService` pools every source for `similarTo` — two sources disagreeing about who resembles Portishead are two opinions, not a conflict — so the order there only decides whose ids survive when both name the same artist. `topTracks` and `similarTracks` take the FIRST usable answer and stop, so for those it decides whose judgement airs. Until `rotation.similarityOrder` that order was `record.id.localeCompare`, which on a station running all three bundled sources means `deadair.deezer`, then `deadair.lastfm`, then `deadair.musicbrainz`: an accident of spelling, and nothing an operator who trusted one source over another could change short of disabling the others. The setting is a `list` of plugin ids, and it is now one of six that share the same machinery: `plugins/plugin.order.ts` reads any of them with `pluginOrder` and sorts with `byOrderThen`, which puts the listed ones first in the order given and leaves everything else to the capability's own fallback — alphabetical here — so **an empty setting is exactly the old behaviour**. Which key belongs to which capability is one row of `plugins/plugin.providers.ts`, and `SimilarityService.plugins()` reaches its sources through `pluginsInOrder` over that row rather than composing the sort itself. It orders and never gates: an id that is listed but not installed is absent rather than an error, and a source left out is asked after the listed ones rather than switched off — a setting that could silently disable the only similarity plugin would turn a typo into a station with no discovery. `SimilarityService` is scoped, so the setting is read once per refill and a change applies at the next one; the day-long cache holds merged neighbours rather than the order, so nothing needs invalidating.

**A playlist can ask for its neighbours to be mixed in, and they are seeded from the playlist, never from what aired.** Spotify's Smart Shuffle is a playlist with recommendations among it, and nothing here did that: the similar share of a refill only starts once a playlist runs out. `PutOnAirInput.mixInSimilar` (or `rotation.mixInSimilar`, off by default on the chart mix's argument: a playlist is what the operator chose) rides the broadcast's `rules`, and after the put-on-air commit the director sends one `director.mix_in_similar` job. `MixInSimilarJob` takes every `rotation.mixInEvery`-th planned record as an ANCHOR (four by default, at most `MAX_MIX_INS`), asks `SimilarPicker.pickLike` for one record like each anchor (the record-level `similarTracks` first, where a plugin implements it, then the anchor's artist through the same walk `SimilarSetGenerator` runs, lifted out of it for this), resolves the lot once through `PickResolver.resolve` with the broadcast's rules, and posts one `interleaveTracks` command naming each record's anchor. Three things are load-bearing. **The seed is the anchor, not the history**: at the moment a playlist goes on air the history is entirely the previous programme, which is the "Mitch Murder opened on thirteen thrash records" failure `SimilarSetGenerator.seeds` records. **Only a rotation mixes**: `resolveRules` ties the switch to `mayGenerate`, so a setlist or a feature refuses it whatever it asks, unlike crossfade, which a setlist may ask for; and a chart is excluded at the send, being somebody else's published document. **A pick that comes back from the resolver under a different name is dropped**, because the anchor is matched by song key and a guess would put a record after the wrong line. An operator who asked and got nothing is told: `order.mixInEmpty` on the feed, with no similarity plugin or with every pick refused.

**A route is a source too: one artist to another, one record per stop, and every step has a reason.**
`PutOnAirInput.routeFrom` and `routeTo` put on air the cheapest path `planRoute` (`route.planner.ts`) finds
between two artists the library can air a record by (`RouteRepository.ownedArtists`, lead credit, a live
copy, nothing disliked). The links are of two kinds, and the planner keeps which one each hop took: a FACT,
two artists credited together on a record the library holds (`coCredits`, off `deadair.track_artists`),
and an OPINION, one similarity source naming the other (`similarTo`, which now says which plugin's answer
it was). A fact is strength `1`; an opinion is the source's `match`, or its rank where it gave none,
because a score is only comparable inside one source's answer. Every hop costs a base, its weakness, and a
fixed penalty that keeps a short plausible route ahead of a long chain of tiny gains, and those weights are
unfitted and say so. The search is bounded at thirty expansions and sixteen stops, since every artist
expanded is a similarity question to every source. `RouteService.records` then takes one record per stop,
a liked one first and otherwise the one longest off air, and the lot goes through `libraryTracks` and
`PickResolver.vet` exactly as an album does, so a dislike, the period and the advisory policy hold and a
stop that fails them closes the route up. **Planned in the request, unlike a chart**: the console's preview
(`POST /director/route/preview`) asks the same questions first and fills the day-long similarity cache, so
going on air afterwards walks answers already held. `source` is `route`, which the mix-in already leaves
alone. Not yet a schedule-slot source, and MusicBrainz's artist relations (members, collaborations) would be
a second kind of fact the planner could use; neither is built.

**A playlist put on air is a source, not a generator, and the instruction still applies to it.** `DirectorConsoleService.putOnAir` never names a `SetGenerator`, so it cannot go through `resolve` — and it must not, since `resolve` respaces a batch and overwrites title and artist from the catalog row, and a playlist's order and strings are the operator's own. `PickResolver.vet(tracks, { era, preference })` is the narrower method for exactly this: order-preserving, no rewritten strings, and built from the same `rejectBarred`, `withinPeriod` and `bindingsFor` calls `resolve` makes, so a dislike, a period and the advisory policy hold for a track that arrived on a playlist exactly as they do for one a generator picked.

**The playlist's order is the operator's, but where a schedule slot STARTS in it may be the station's.** A slot with `resumePlaylist` opens on the record after the last one from its playlist that aired, rather than on the first, so a playlist longer than the block gets through all of its records over several nights instead of airing its opening hour every time. The order itself is untouched: the vetted list is turned round, not reshuffled, and the turn happens after `vet` so the place is looked for among records the station will actually play. A record no longer there starts the playlist from the top. The place is a song key in `schedule_playlist_positions`, moved only by records the broadcast opened with as they air; how, and why it is not a cursor over the running order, is `director.md` § "Who owns the running order".

**A pick the catalog has never seen is looked up at a provider and INGESTED, and the order of that against the
rules is load-bearing.** The library holds what the account's playlists carry, because playlists are the only
enumeration a provider offers, so a perfectly good pick outside them used to be dropped.
`PickResolver.identify` now falls to `ProviderTrackLookup`, and a hit becomes a real `deadair.tracks` row with
a binding — it has to, because the player fetches every record through `track_sources`, so a copy with no
binding has no URL. The lookup is STRICT (normalized title and lead artist must both match exactly; duration
only breaks a tie), because a near-miss does not error, it airs the wrong record while the console says
otherwise. It is bounded per resolve (`MAX_DISCOVERIES`, counted as attempts) since every miss searches every
provider, and gated by `rotation.discover`, on by default because off makes the path inert.

**Ingest happens BEFORE the rules run**, which is what makes a newly ingested record by a disliked artist get
dropped rather than aired for want of an opinion. The other half is `track_sources.origin`: the sync's
`markMissingTrackSources` only judges `origin = 'sync'`, because the sweep is an argument about what a
playlist WALK saw and a discovered copy is in no playlist — without it the first sync after a discovery
benched everything the station found for itself. A walk that later sees a discovered copy moves it into the
sweep; a lookup never moves a synced one out. What judges a discovered copy instead is fetching it, via the
four-failure bench in `TrackAudioService`.

**The walk starts three ways, and only one of them is judged by the schedule.** `catalog.sync` fires on an
hourly cron that never changes; `CatalogSyncJob` recognises that run by its payload having no keys (pg-boss
delivers a cron run's payload as `null`) and returns early when `catalog.autoSync` is off or the hour is not
a multiple of `catalog.syncEveryHours`, counted from the epoch in UTC, so "due" needs no record of the last
run and a retry inside the hour is still due. The other two are SENT and always run: a provider changed
(`{ pluginId }`, when its settings are saved, it is enabled, or an account finishes connecting to it over
OAuth) and an operator's refresh (`POST /playlists/refresh`, `{ requestedBy: 'operator' }`). Disconnecting an
account deletes the playlist list kept from it in the same transaction, since the next account may be
somebody else's.
That is why every sender carries a key: a send of `{}` would be read as the schedule and could be skipped.
Only an operator's walk goes on the activity feed, as one `sync.finished` entry, because the button can only
answer "queued" and somebody is waiting to learn it finished.

**A walk of one playlist ingests and never sweeps.** `POST /playlists/{pluginId}/{playlistId}/refresh` sends
`{ pluginId, playlistId, requestedBy }` and `CatalogSyncService.syncPlaylist` reads that playlist's tracks
alone. The sweep above is an argument about what a walk of EVERYTHING a plugin offers saw, so swept against
one playlist every other record from that provider would read as gone, or the proportional guard would
refuse every time and warn the operator about a walk that did nothing wrong. A record taken out of that
playlist stays until the next whole walk judges it. A hidden playlist is refused, 409 at the route and
`hidden` in the walk, on the rule that hiding one takes it out of the library.

**The Library page answers from the list the walk kept, and asks a provider live only for a source with nothing
kept.** It used to ask every provider for its playlists on every visit, inside the plugin's call timeout, and a
Spotify that was slow or rate limited (the walk reading it at the same moment was enough) answered nothing: the
page went empty although the walk had read every playlist minutes before and thrown the list away. The walk now
reads a plugin's whole list before any of its tracks and keeps it in `deadair.provider_playlist_listings`, one
row per plugin replaced whole, and only when the list was read to the end, on the sweep's own rule: a list cut
short at the page cap, cancelled or failed is never kept, because every playlist it missed would vanish from the
page. The walk is the only writer; `PlaylistsService` reads it, and a source's live answer is not kept from
there, since a settings save has already queued a walk for that plugin. Hiding is applied when the list is READ,
so it never waits on a walk. A quarantined or misconfigured source still lists what was kept beside the error
saying why it is not answering; a disabled one lists nothing. `sources[].listedAt` says how old each list is, and
the console reads the page again after Refresh until every list is newer than the press.

**A station playlist is a clone, and every way in is one list of entries.** `deadair.playlists` sat empty from
0005 until import existed; now a file (`playlist.file.ts`, keyed by words and ISRC and never by this
station's ids, per [backup-and-restore](https://github.com/robert-dean/deadair/discussions/6)), a text list
(`playlist.text.parser.ts`: M3U by its `#EXTINF` lines, CSV by header name, `Artist - Title` lines), a pasted
link and a provider playlist the station lists all become the same entries, and `PlaylistImportPlanner` is
the one thing that decides what they would be here. The preview and the import both run it, so the preview is
the decision rather than a forecast of it. It only LOOKS: `findTrackSource` for an entry that names a
provider's copy, then `findTrack` on the resolver's own keys, and nothing is searched or ingested while an
operator waits on a preview. Every entry becomes a row, in its place: a match, or a placeholder carrying its
snapshot, and since 0051 a placeholder may be a snapshot with no provider id at all, because a line from a
file names a record and no copy of it. Refusing that row would lose the record and its position, which is
the lossy import 0005 was written against.

**Filling a placeholder is discovery, run as a job rather than in the request.** `playlists.fill` is sent
after an import that left placeholders and by the page's button, and `PlaylistFillService` walks a ladder
that is cheapest and most exact first: the library again, then the provider copy the row was cloned from,
asked for by id (the only way a file from another station's Spotify lands on the same recording here), and
then `ProviderTrackLookup.find`, the strict search `PickResolver.discover` already trusts. A hit is ingested
as `discovered`, for the reason the paragraph above gives. It is gated on `rotation.discover`, because that
switch is the station's one answer to "may it add records to its own library", and it is bounded per run
(`MAX_FILL_LOOKUPS`) because every miss searches every provider one after another. It is a `PlainJob`
because it talks to providers between writes. What it misses stays a placeholder, and
`catalog.resolve_placeholders` matches it whenever a sync grows the library.

**A link is claimed by the provider it belongs to.** `MusicProviderCatalog.playlistIdFromUrl` is an
optional PURE parse; the import asks every catalog provider in id order and the first to claim a link wins,
which is why a provider claims only what it is sure of (Navidrome, Jellyfin and Emby only a link into their own configured server, Plex only a Plex Web link naming its own server's machine id, which it learns on its first playlist walk).
It is called directly rather than through the invoker, since a throw there is a bug in a string function
and must not count toward quarantine the way a failed upstream call does. The tracks are then read through
`PlaylistsService.getPlaylistTracks`, so the access narrowing and Spotify's refused-playlist fallback both
apply exactly as they do when the console lists one.

**A chart pick carries where the chart placed it, and nothing else in a pick does.** `chartPicks` sets
`TrackPick.chart` (rank, the chart's name from `ChartsService.nameOf`, and the peak and the run only where the
source gave a positive whole number), `PickResolver` copies it onto the record it resolves to as the one field
taken from the PICK rather than the matched row, and it rides `station_lineup.items` inside the track, so a
restart keeps it. Both chart paths set it: a chart aired whole and `ChartSetGenerator`'s share of a refill. It
is a fact about the edition the station read and is never updated; a chart that moves on afterwards does not
move a record already in the order. It decides nothing about what airs. What reads it is the break writer
(`breaks.md`), and whether a show says it is `StationLineupRules.chartPositions`, absent meaning yes.

**A chart airing inside a slot is cut to the time the slot has left, from the top.** A hundred-record chart
in a four-hour block played ranks 100 down to about 45 and was cut off by the next changeover, so the part of
a countdown everybody waits for never aired. `putOnAir` reads the slot before the tracks now, and
`chartTracks` resolves the chart in RANK order, keeps the longest run from number one whose lengths fit
(`fitAirtime` in `chart.airtime.ts`, counting each record by `recordSpacingLength`), and only then turns it
round for a countdown, for the same reason `chartPicks` caps before it reverses. The budget is
`minutesLeftInSlot` less `CHART_TALK_SHARE` (a twentieth, measured from what the station says) when the
broadcast takes breaks, and the run may go PAST it by the record that airs last, up to
`schedule.overrunMinutes`: a changeover leaves the record on air playing, so number one only has to start
before the boundary, and fitting strictly inside finished a setlist early into silence, since a setlist
cannot top itself up. Number one never starts after the boundary, which is what a changeover would drop.
Lookups
are capped to about half again what fits (`lookupsFor`), so a one-hour slot does not search a hundred
records. A station with no schedule airs the whole chart, and so does `ChartSetGenerator`'s share of a
refill, which has no shape to end on.

**A countdown that falls behind is cut again, from its lowest ranks still to come.** The fit above is made
once, and everything after it holds the order where it stands: the audience gate keeps it exactly where it
stopped, a setlist cannot top itself up, and a changeover drops whatever is queued behind the record on air.
The US countdown on 2026-10-23 sat out 47 minutes with nobody listening, picked up at number 34 with the same
13:00 to beat, and never aired the top eleven. So `putOnAir` stamps `countdownEndsAt` on the order (the slot's
end, from the top of the minute the fit read, migration 0112) for a chart cut to a slot and played as a
countdown, and every commit pass runs `keepCountdownOnTime`, which asks `overdueCountdown` (`chart.airtime.ts`)
the fit's question again of what is left: the countdown records still `planned` and not kept by `staysPut` are
fitted from number one into the time to the end, with the same talk share and the same overrun, after charging
everything else ahead of them (the rest of the record on air, anything the player holds, a request, the record a
held break announced), and the lowest ranks that fall outside are spliced out and named on the feed
(`order.countdownCut`). A break written for one of them is reopened as any broken promise is. Every pass rather
than on the audience arriving, because the gate is one way to fall behind of several, and while the station is
quiet too, so the first record a returning listener hears is already one that fits. It cuts only before the end
and never while an operator holds the broadcast, since past the end a cut protects nothing, and that is also
what keeps a countdown on `on_end: 'repeat'` from being cut down to number one on its replay. It never adds a
record back: a countdown running early stays as it is. The deadline is the slot's end as it stood at `putOnAir`;
an operator who moves the slot's end mid-show does not move it.

## The station's opinion, and the policy over it

**A suspension is a dislike's instruction with an end date, and it rides every read a dislike does.**
`suspended_until` sits beside `rating` on `tracks`, `albums` and `artists` (migration 0115) and is read at the
point of use against `now()`, after `station_lineup.hold_until`: nothing sweeps it, so nothing can fail
overnight and leave an artist off the air, and a lapsed one reads exactly like one never set. `infinity` is
refused, since an indefinite suspension is a dislike. It never touches the rating, which is the whole reason
it exists: suspending a liked artist for a week must not cost the like. `catalog/suspension.ts` holds the one
predicate (`suspendedNow`, raw so both SQL dialects here can take it), and it reaches through
`track_artists` for `credited.dislike.ts`'s reason, so a suspended act is not back on air as somebody's
guest. Every query that keeps a disliked record off the air carries it next to its rating clauses: the
draw, `searchPlayable`, `ownership`, `dislikedArtistKeys`, `styleVocabulary`, the route reads, a listener's
requestable records and the artists a brief names. In memory, `CandidatesRepository.standingsFor` (once
`ratingsFor`) answers the rating and the suspension side by side, and `rejectBarred` (once `rejectDisliked`)
drops both, so there is one filter rather than a second one that must always be called beside the first.
The dislike veto that reaches into the running order (`vetoDisliked`) reads the rating alone on purpose: a
suspension does not empty the order, and the two or three records already in front of an operator are
theirs to remove.

**An opinion is held at three levels and inherits DOWNWARD in both directions.** `artists`, `albums` and `tracks` each carry a `rating` of `-1 / 0 / 1`, written from the console through `PUT /catalog/{artists,albums,tracks}/{id}/rating` (`platform.manage`; the wire spells it `liked / neutral / disliked` and `catalog/rating.ts` is the only place that meets the column, because the ORDERING is what the SQL below needs and nothing outside the database reads it as a number). `CandidatesRepository.effectiveRating` is the one expression that collapses the three into one, and it is **not** a `least()`: a dislike anywhere wins outright, because a dislike is an instruction no lineup may turn off, and otherwise the strongest LIKE carries, because liking an artist means play more of them and liking one song means play that song more. It was a plain `least()` for as long as it existed, which got the veto right and silently swallowed the other half — a liked song on an unrated record by an unrated artist came out `0`, so `weightOf` doubled nothing an operator could produce without rating all three levels identically, and liking a record did nothing whatsoever. Both `sample` and `standingsFor` go through it so the draw and the resolver cannot disagree. Nothing unit-tests it, since it is SQL: `apps/api/scripts/rating.smoke.ts` is what covers it, against the real database.

**A dislike also reaches a running order that is ALREADY BUILT, which for a long time it did not.** The two
places above — the draw's own SQL and `PickResolver.resolve` / `vet` — are both places a running order is
BUILT, and a lineup is then a stored list of items walked by state, with `StationLineup.nextPlanned` reading no
rating at all. Measured on the live station on 17 September: it went on air at 07:32 from an imported playlist,
so every record on it was vetted at that instant; the operator disliked an artist at 08:23; two of that
artist's records aired at 09:10 and 10:44 and two more were still `planned` hours later. Nothing was broken —
the rating was written and every later DRAW honoured it — the order simply never asked again. `CatalogModule`
is registered before `DirectorModule`, so the fix is the backwards edge `StationBus` exists for: the catalog
publishes `catalog.disliked` from an `AfterCommit` hook (published inline, the subscriber's read answers with
the row as it stood BEFORE the write, which is the original bug with a mechanism in front of it), and
`DislikeVeto` forwards to `DirectorConsoleService.vetoDisliked`. That **re-judges the whole remaining order
through `standingsFor` rather than resolving what was rated to a track list**, which is not a shortcut: it is the
same expression the draw uses, so a disliked artist GUESTING on a record is caught here exactly as it is at the
draw, where matching on the lineup's own `RundownItem.artist` would have seen the lead and only the lead. A
line whose `trackId` the catalog does not hold is KEPT, which is `vet`'s own answer at the same fork. The edit
goes through `StationLineup.remove`, so a forbidden break is marked rather than spliced and a forbidden beat
takes its production with it; a record the player is holding is marked `skipped` and the queue retracted; and
the record ON AIR is cut where it stands, in the two fixed halves a skip to a record already uses — the order
inside the mailbox, `PlayoutPusher.skipCurrent` outside it, because the cut waits out a boundary. A refill is
re-armed and `reopenPromises` rewrites a break that promised one of the departed records, both of which
`DirectorService.thin` was already doing for the record that cannot be fetched.

**An advisory is a LABEL on a COPY, and the policy over it is not a rotation rule.** `track_sources.advisory`
is `explicit` / `clean` / null, per BINDING rather than per track because a clean edit and the explicit
original collapse to one `deadair.tracks` row (`resolveTrack` matches on `title_key` + artist and the edit's
own ISRC misses) and stay two copies — the binding IS the version, so `rotation.advisory` (`prefer-explicit` /
`prefer-clean` / `clean-only`) is almost entirely binding selection in `CandidatesRepository.bindingsFor`, and
a work left with no eligible binding falls into the existing "nothing can play this" drop rather than a second
mechanism. Four things are load-bearing. It is named for the LABEL and not the words — nothing here reads a
lyric, Spotify is passing on a marking — so **`lyrics` stays reserved for the text**, which
[track-lyrics](https://github.com/robert-dean/deadair/discussions/47) wants for a thing the station may read and never say; `content_rating` was
rejected because `tracks.rating` already means the operator's `-1/0/1` opinion. It is read at the point of use
and deliberately **not on `ResolvedRules`**, because `NO_RULES` zeroes that bag and a setlist — whose whole
mechanism is starting from the rules off — would silently begin swearing; it follows `rejectBarred` instead.
The advisory **outranks the operator's provider preference**, since the policy is a rule about content and the
provider list is a preference about delivery, and ranked the other way a `prefer-clean` station whose clean
copy sits on the second-choice provider is handed the explicit one from the first with nothing saying why. And
`clean-only` demands a **positive `clean`**: most providers never mark anything, so a library from one of them
plays nothing, which is the honest answer and is paid for in the setting's help text and in `AdvisoryWatch` —
it tells that state apart from an empty catalog by asking the same draw again with the policy off, and writes
one `station_events` row on the edge. The presenter side is separate and asymmetric on purpose: `speaksClean`
is true for BOTH non-default states, because a preference is only a lean about which copy to play when there
is a clean twin to choose, and a presenter always has the choice of their own words. Nothing checks the
model's answer against it. `apps/api/scripts/advisory.smoke.ts` covers the SQL.

**The operator's own account-level explicit filter is reported and never enforced** — the plugin reads
`explicit_content.filter_enabled` and `filter_locked` off a profile call it already makes — because the audio
comes through the shim rather than the Web API and whether that filter binds on the fetch path is unmeasured;
see [clean-copy-matching](https://github.com/robert-dean/deadair/discussions/9), which also holds the deferred matcher for a clean copy the playlists
never carried.

## Never-play rules, and the genre steer

**A rule forbids a KIND of record, beside a dislike, which forbids one thing.** Ideas #22 is the design and
`director/block.rules.ts` the evaluation: a `genre` rule refuses any record tagged with that genre or a kind
of it (`genre.match.ts`: words compared after `normalizeKey`, the target a contiguous run inside the tag, so
`Punk Rock` falls under `Punk`, plain `Pop` never under `Pop Punk`, and `Trap` never under `Rap`); a `tag`
rule is exact. A `version` rule refuses a version of a record rather than a kind of music, and `live` is the
only one: `live.version.ts` reads the markers a provider writes on the title and the album ("War Pigs -
Live", "(Live)", an album named "Live in Nottingham" or ending on "Live"), never the word wherever it falls,
because "Live Wire", "Live And Let Die" and *Long Live The Kane* are studio records. Measured on the live
station, 2026-10-14: no record of 5485 was TAGGED live, and the reader flags 35, every one a live recording.
It reads text rather than tags, so `NeverPlay` reads titles and albums (`CandidatesRepository.namesFor`)
only when a version rule holds, the draw's SQL is given only the tag rules' targets, and the model's search
judges a provider row by its title and album where a genre rule cannot judge it at all. Scopes are a season of `MM-DD` days wrapping the year end, a window of hours wrapping midnight,
station modes, schedule slots and an expiry, each optional and absent meaning always. Rows live in
`deadair.block_rules` (0069). **Exclude only, and absolute**: no "only these genres", and no relaxing when the
station runs short, including for a listener request. A record nobody tagged falls under nothing.

**Enforced where a dislike is, never beside it.** `NeverPlay` (`never.play.ts`) narrows the rules once per
call and reads tags only when one holds, through `CandidatesRepository.tagsFor`, the one place the tag union
is written for the pick path (the enrichment `genres` arrays at the track and at its artist, never the
promoted `tracks.genre` scalar). `PickResolver.judge` drops a blocked pick FIRST, beside `rejectBarred`
and not on `ResolvedRules`, so `NO_RULES` cannot zero it and a setlist still obeys it; `vet` holds it over a
playlist, a chart, an album and a single record. Callers pass the broadcast they pick for (`PickBroadcast`:
mode and slot) so a scoped rule is judged against it; one that cannot say leaves a scoped rule unjudged
rather than guessing. The model's music search asks the same class and over-fetches three times so a model
is not shown what the station will refuse and is not left with too few rows. Records already in a running
order stay: a rule holds from the next pick.

**The floor refuses before it draws, too, and the resolver stays the guarantee.** With the rules applied only
at `PickResolver`, `CatalogSetGenerator` drew a sample, weighed it and chose among records a rule would
refuse, so a station refusing most of its library got a batch the resolver emptied and a refill that
starved with playable records still in the library. The generator now asks `NeverPlay.holding` with the
broadcast it is drawing for (`SetInputs.broadcast`, passed by `planRecords`) and draws round what holds.
**SQL gets only exact equality** (`SampleExclusions.refusedTags`: a tag that IS the rule's value, ignoring
case and outer space), because that is provably a subset of what `genre.match.ts` refuses; a SQL copy of the
word-boundary fold would be a second matcher, and in the exclude direction a disagreement is a silent
over-block. Each drawn batch is then judged by `NeverPlay.blockedUnder`, the resolver's own code, and what it
refuses is made up by drawing again without anything already drawn, the next draw sized from the refusal rate
so far, at most four draws. A rule table that cannot be read costs the early filter and never the batch.
Neither half is deletable because the other exists: picks reach the resolver from generators that never read
this repository. The console's rules panel limits a rule to modes and schedule blocks, and names a block that
has since been deleted by its id.

**The steer is the positive half #22 refused to make a rule, and it is a weight.** `deadair.genre_steers`
holds one lean per station: genres until a time. `CatalogSetGenerator` draws a second, loose sample of
records tagged with something CONTAINING a steered genre (positive, so loose is safe), matches the whole
draw precisely, and gives a real match `STEER_LEAN` (four) times its weight through `RotationCandidate.lean`.
`ModelSetGenerator` puts it in the user turn as "choose mostly from these, and still choose something else".
Nothing ever removes a record for being outside a steer, so it can never leave the station with nothing to
play: a lean toward a genre the library barely holds plays what it has and fills the rest as usual.

## What the model is offered

**ONE search tool, because the split between two was a decision the host could make itself.**
`MusicSearchTool` (`search_music`) reads `deadair.tracks` and fans out over the provider plugins in one
answer, and every row carries `owned`. It was two tools — `search_library` and `search_catalog` — and choosing
wrongly used to be silent and fatal, because a provider pick matched no catalog row and was dropped.
`PickResolver`'s lookup rung ended that, and in ending it turned the split into a PREFERENCE the model had to
arbitrate on every call using no information the host lacks. That arbitration is where briefed refills died:
told to search the library first and reach past it only when it could not fill the ask, a model briefed
`artists like mitch murder` against a library of rock and metal searched the LIBRARY for one synthwave
neighbour after another, got nothing every time, and ran out of tool steps before it answered. So the
preference is now a field rather than a choice: an owned record is catalogued, bound, usually on disk and
measured, and an unowned one is fetched when it is chosen. Four things are load-bearing.

**`ownership` matches the resolver's own keys** (`title_key` + `artist_key`, the same ones
`CandidatesRepository.findByName` uses), because `owned` has to be the claim `PickResolver.identify` will act
on rather than a looser one that reads as free and costs a download.

**Bans narrow BOTH halves now** — `dislikedArtistKeys` is a second read precisely because a provider row by a
banned artist joins to no catalog row and the first cannot see it — while **rotation rules still narrow
neither**, since variety is enforced at the point of choice and pre-filtering returns a worse pool on a small
library. The shortlist below DOES screen by the rotation rules, and only because it screens with the
resolver's own give-way rules, so it is never narrower than what `PickResolver` would keep.

**The providers are reached only when the library comes up short** (`THIN`), or always if the operator sets
`llm.alwaysSearchProviders`; the default is not merely thrift, because break writers share this tool and
theirs check a record already in the catalog, so under the default a break write never waits on a provider.

And **`OWNED_SHARE` reserves room for the provider half**, or a brief the library HALF matches fills the
answer with owned records and the failure moves from the model's choice into the ordering. A second tool,
`StationTasteTool` (`station_taste`), answers what the operator has liked and disliked; it reports and never
enforces, and `ModelSetGenerator` also puts a short version straight in its prompt so a model that cannot
drive tools still gets the steer.

**A brief that names its acts is programmed from a numbered list, and the model answers with numbers.**
Measured on the live station, 2026-10-25, The Church, refill trace `51fea6af`: five `search_music` calls of
about four seconds each, then the final answer generated for two minutes with no tools and ran out of the
180-second budget having named nothing: 29,564 tokens, about 5,600 characters of reasoning, on `gemma4:26b`.
The rescue filled the batch from the searches and `PickResolver` kept one of twenty, because they were
repeats and acts inside the cooldown. Searching was not the cost; WRITING the answer was, and most of what
would have been written could never air. So `Shortlist` gathers the library's records by the acts
`BriefActs` reaches and what the store holds for them and their neighbours, screens them through
`PickResolver.screen` (the resolver's own reads and windows, with the per-batch caps left to the batch and
`RepeatWatch` untold, since nothing has aired), and lists up to 60, one per artist per turn, each artist's
never-aired records first. `shortlistPrompt` is a few rules and the list, a quarter of `setPrompt`'s system
turn, and `readChoices` reads numbers off it, with a `{"title","artist"}` object beside them for a record the
model searched for: the search stays, two rounds and nothing else (`SHORTLIST_TOOL_STEPS`), for what a list
built from acts cannot hold, such as a song the brief names by title. A model that names nothing has the
batch drawn from the list (`drawFromShortlist`: freshest and the brief's own acts first, at most the
per-artist cap) before the search rescue. **A list shorter than the batch is never offered**, nor one for a
brief naming no acts, and `llm.setShortlist` (on) turns it off: each of those is the search-driven refill
exactly as it was.

**A listener's request search reaches the providers on the same terms, through `RequestProviderSearch`
rather than this tool.** It reuses `ProviderSearch` and the same two narrowing reads (`ownership` and
`dislikedArtistKeys`, guests passed as well as the lead), and differs in four ways that come from a person
browsing rather than a model asking. It has no `THIN`: it is asked on every search and fills whatever room
the library left on the page, because a listener searching an artist the library holds three records by
wants the rest of them, where a model wants one record and has it. It is never reached while `rotation.discover`
is off, because the row it offers becomes a library record the moment somebody asks for it. It leaves out
anything the catalog holds rather than marking it owned, because a held record the library half did not
return was kept out of it for a reason (a dislike, no playable copy) that holds here too. And each term's
answer is cached for a minute in a static map, because every provider asked costs its rate limit, its
timeout and a step toward the invoker's quarantine; the apps' search boxes debounce for the same reason, so
a term is sent once the typing settles rather than per letter. Neither binds a caller that is not one of the
apps (a script, an MCP client), so the server debounces too: a term already being asked about is joined
rather than asked twice, and a term reaching the providers fresh spends one of the account's twenty a minute
and one of the station's hundred and twenty (`RequestSearchLimiter`, in Redis). Out of either, the search
answers with the library alone and caches nothing, rather than a 429: a person typing too fast still gets
an answer, and a script gets nothing out of the providers. The row carries
the provider's own id (`FoundTrack.externalId`, which the model's tool never shows it), and asking for it
goes through `ProviderCopyResolver`, the ladder the playlist fill uses.

**The library half matches by whole words and ranks by equality, and the two are different jobs.** `searchPlayable` finds a record whose title, artist, promoted genre or any tag holds the search as WHOLE WORDS (`regexWholeWords`, a letter or digit on one side and anything else or the end of the text on the other), which is what lets `metal` reach `heavy metal` and `rock` reach `pop/rock`. It was containment until 2026-10-11, when a heavy-metal refill searched `Dio` and `ilike '%Dio%'` filled the page with "Radio Edit", "Audio Remix", "Diopter" and "Dior", which a timed-out model then had rescued onto the air (see the rescue above). The price is a search for part of a word, "Metalli" or `heavy met`, which finds nothing now; the model searches names and styles whole, and the console's own catalog filters and the request search, which a person types fragments into, still use containment. Until 2026-09-30 that was also the whole ordering, a per-broadcast hash over every match, and under `ModelSetGenerator` the search is the draw: briefed `billboard top 100 across the decades`, the model searched `pop` and `soul`, and was handed Anthrax's "Caught In A Mosh" (tagged `pop/rock`, the umbrella one source hangs on every rock record) and Testament's "Souls of Black" (a title) among the ten owned rows of each. It named both. 588 records were tagged exactly `pop` and 122 exactly `soul`, so a page of the real thing existed and was drawn against 369 and 39 that were not. Rows where the search IS the title, the artist, the genre or a tag now come first (`isExactly`), and the hash orders within each half. A rank and never a filter: narrowing the match to whole tags would lose `metal` every record tagged only `heavy metal`, and a title searched by one of its words still has to answer. What it does not fix is a style with fewer exact records than the page, where the tail is still whatever holds the word, each row carrying the `genre` that says so. Whole words cured the "Souls of Black" half of that measurement and not the `pop/rock` half, which is why the rank stays.

**The search answers with the LEAD artist, never a credit line, and that is a correctness rule rather than a formatting one.** The model is told to copy a title and artist back exactly, because `ProviderTrackLookup` is strict — and the two steps that then judge the pick both match on the lead artist alone: `PickResolver.identify` keys it off the MATCHED ROW's title and lead (`songKey(found.title, [found.artist])`, so the keys are the ones `play_history` will be written with rather than the words that went looking) and the lookup compares `normalizeKey(track.artists[0])`. The provider fan-out answered `artists.join(', ')` for as long as it existed, so every collaboration it returned was named correctly by the model and then dropped as "not in the catalog" — a live run resolved every solo credit and lost every duet. The other credits ride in `featuring`, which is shown and never copied. Anything new that hands a model a record to name owes the same shape. The related bound is that it must offer enough rows to fill an OVERSAMPLED batch (`MAX_RESULTS` is 25): a model shown ten records and asked for two dozen pads the answer with repeats, `SetGeneratorChain` discards them, and `CatalogSetGenerator` — which cannot act on a brief — quietly fills half the hour.

**An item's `artists` is a display credit and its `artist` is the identity, and nothing may take one for the
other.** `RundownTrack.artists` is a list because a provider gives one, but half the producers only ever have
the credit as a single string: an item built from a playlist holds `['USHER','Lil Jon','Ludacris']` and one
`PickResolver` resolved holds `['USHER, Lil Jon, Ludacris']`. So `artists[0]` is the lead only by luck, which
is why `artist` exists beside it and why every key comes off that — `play_history`, `songKeysOf` (the
generator's avoid list) and the scrobbler. It was `artists[0]` in all three for as long as they existed, so
the writer stored `drake wizkid kyla` as one artist while every reader asked about `drake`: no repeat window
or artist cooldown could match a collaboration, and Last.fm was sent a credit line as an artist name.

**Nothing showed** — the only symptom of a rotation rule that never matches is a station that repeats itself,
which is the failure `rotation.keys.ts` opens by warning about. `PickResolver` fills `artist` from the catalog
row it MATCHED (or the provider row it just ingested), never from the pick that went looking, so the keys a
record is judged by are the ones it will air under.
