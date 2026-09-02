# Deferred: lyrics as enrichment, and the one thing they may never be used for

**Written:** 2026-08-16, from "add track lyrics as enrichment".
**Verified:** 2026-09-02, twice. The first pass re-checked every provider claim live and measured one
against this station's own catalog; two of the five rows were wrong and are corrected in place rather
than appended, because a table nobody trusts is worse than no table. The second pass went looking for
prior art and found that the phase this file is worth building for **has been built elsewhere**, which
changed the shape of the answer rather than the choice of source. That is the "a pair of markers"
section below, and it is the most useful thing in the file.
**State of the tree:** none of this exists. No capability, no table, no plugin method. Everything it
would attach to does.

---

## The constraint that shapes the whole file

A lyric is somebody's copyrighted text in full, and it is the one kind of enrichment the station
must never do what it does with everything else to: **say it out loud.** Every other payload in
`capabilities/enrichment.ts` exists to be spoken or shown. This one exists to be read by the host
and by nothing else.

That is not a caution, it is a structural rule, because there is already a path that would break it
with no model involved and no way to decline. `SourceDocument` is prose handed over verbatim for the
host to extract claims from, and the floor extractor (`fact.lead.ts`) takes an article's OPENING
SENTENCE as a claim, because there the claim and the quote are the same span and nothing can
hallucinate. Hand lyrics over as a `documents[]` entry and that floor writes the first line of the
song into `facts.claim`, with `facts.source_quote` set to the same line, and the break writer then
says it on air with a citation. The floor cannot fail, which is exactly why it must not be pointed
at this.

So the first decision is a negative one, and it is the load-bearing one:

- **Lyrics do not arrive as `documents`.** Not as a convenience, not "for now".
- **A lyric never becomes a `deadair.facts` row.** `source_quote` is a column whose entire purpose is
  to be displayed and to be checkable, which is the opposite of what a lyric quote may be.
- **Lyrics are stored and never sent**, the way source documents already are: `forTheWire` drops
  `documents` out of the enrichment read, and anything holding lyric text needs the same treatment
  from its first commit rather than after the console has already shipped a panel.

**And the hazard is not confined to a lyrics provider.** Verifying the Genius row below turned up the
same rule needing to be stated one file over: an ANNOTATION arrives welded to the lyric line it
annotates. A referent carries the highlighted `fragment` plus up to 200 characters of the surrounding
lyric on each side, so annotation prose reaches the host with copyrighted text attached to it.
Anything that treats annotations as a `SourceDocument` inherits this file's hazard whole, which is
now recorded in `fact-enrichment.md` too, because that is the file whose path it sits on.

Everything below is what lyrics ARE for, given that.

## Four uses, and they are not equally worth building

| Use | Needs a model | Text ever leaves the row | Worth |
| --- | --- | --- | --- |
| Vocal onset for the talk-up limit | no | no | high, and cheap |
| Derived labels (subject, explicitness, language, season) | yes | no | high, and the reason to keep the text |
| The DJ knowing what a song is about | yes | into a prompt | real, and the only risky one |
| An excerpt in the similarity embedding text | no | into a vector | small, nearly free, and it was missed |
| A lyrics panel in the console | no | yes | not scoped here |

**The vocal onset is the one that pays for the feature**, and it needs no intelligence at all.
`track-analysis.md` defers a beat layer whose `vocal_onset` field has one consumer, the talk-up
limit, and the four measured cue points only approximate it: `introEnd` is "the beat established, OR
the vocal in", which is a detector's guess about two different events. A synced lyric already
carries the answer as a timestamp somebody typed while listening, and it arrives with no decoder, no
model, and none of the licence exposure that made `docs/decisions/analysis-licensing.md` necessary
(the toolkits that do vocal separation are largely copyleft; a `[00:12.40]` is a number).

Three things keep that honest and all three belong in the code that reads it. **Read the marker
section after them**: it is what this use turned out to be once somebody had built it, and the first
timestamp is a third of the answer rather than the whole of it.

- **The first timestamp is the first LYRIC LINE, not the first vocal**, and the size of that gap is
  now measured rather than asserted. Across 52 synced lyrics fetched for this station's own records,
  the first timestamped line carrying text sits at a median of 15.9s (p25 4.5s, p75 28.9s, longest
  87.6s), but **12 of the 52 are under three seconds and 6 are under one second, one of them at
  exactly zero.** Some of those are true, since a record really can shout its first word at 130ms.
  Others are a transcriber timing the title card, or timing a line early so a singer can follow it.
  The consequence is the same either way: `min(introEnd, vocalOnset - safety)` with no floor hands a
  quarter of the library a talk-up of zero. So take the minimum, but floor it, and treat a value
  under a second or two as evidence of a bad transcription rather than of a record with no intro.
  The failure to design against is a talk-up that runs over the first word, which is the single most
  audible mistake a radio station makes. The failure to design against SECOND is a station that
  stops talking up anything.
- **An instrumental is a real answer, not a miss.** A source that says "this record has no words"
  is telling the talk-up limit to fall back to `introEnd` deliberately, which is different from
  having never looked.
- **Most of the library will have no synced lyric.** This turned out to be far less true than
  assumed (see the measurement below), but it can still only ever narrow the limit where one exists.
  It is not a replacement for the beat layer and does not make `track-analysis.md` smaller.

**The derived labels are what makes the text worth keeping.** What a song is ABOUT is not in any
metadata field anyone sells, and it is what two deferred features are short of:
`station-moment.md` wants a mood vocabulary that something can actually match a record against, and
`never-play-rules.md` wants never-play predicates an operator can state ("nothing about
Christmas in July", "nothing explicit before nine"). The split is the one `fact-enrichment.md`
already made and named: **a plugin fetches, the host thinks.** The durable artifact is the labels,
not the lyric, which means an operator who is uneasy about holding the text can be given a switch
that drops it once the labels are derived, and nothing downstream notices.

**The embedding row is new and is the cheapest thing in the table.** A comparable implementation puts
a capped excerpt (400 characters) into the text it embeds for similarity, beside tags, measured
acoustics and an era word, and the reason it gives is the one that makes it worth copying rather than
the lyric itself: with every optional line empty the vector IS the label, so similarity ranks by
artist and album wording, a prolific artist self-clusters, and two unrelated artists whose names share
a word land next to each other while the picker believes it is reading mood. A lyric excerpt is one of
the few inputs that breaks that degeneracy. It costs no model, the text never leaves the row in a form
anybody reads, and it is the only use here that wants the PLAIN lyric rather than the synced one. It
is not scoped in the phases below because it belongs to whatever builds the embedding axis, and is
recorded here so that work does not have to rediscover it.

One trap there: `track_sources.advisory` already carries `explicit` / `clean` per binding when a
provider marks it. A lyric-derived judgement is a weaker, second answer and must be stored as its
own field rather than written over that one, or a station will start disagreeing with its provider
about the same record and no reader will be able to tell which claim it is holding.

**The DJ knowing the subject is the only phase that can put a copyrighted line on air**, and it is
last for that reason. The defence is machinery that already exists: `characterFault` refuses a
script that reproduces more than `MAX_SAMPLE_ECHO_WORDS` consecutive words of a persona's sample
line, and the same check pointed at the lyric text is exactly the right shape, for exactly the same
reason (the lift is as often a clause as a whole line). Two smaller things go with it. A prompt
carrying lyrics is stored verbatim in `script_history` whenever `llm.captureWrites` is on, so that
switch stops being an evening of prompt tuning and starts being a second copy of the text. And what
the model should be handed is the LABELS, not the words, wherever the labels are enough: a writer
told "this record is about leaving a town you grew up in" cannot quote a line it was never shown.

## The shape of the answer is a pair of markers, not a number

Added 2026-09-02, from finding this phase already built on a comparable station and from what
broadcast automation has called these things for decades. **The original design here asked a synced
lyric for one number and that is the wrong question.**

**Derive vocal RANGES over the whole track, not the first onset.** A line's start is a start; its end
is the next line's start, capped, so a long gap reads as an instrumental break rather than as
sustained singing. Consecutive lines closer together than a merge gap join into one range; a wider
gap splits them, which is what exposes a solo or a bridge. The last line has no successor and takes a
nominal tail. Three constants fall out of that and the values that have been shown to work are an 8s
merge gap, an 8s cap on a single line, and a 4s tail on the last one. The first range's start is the
intro cue this file originally wanted; everything else is free.

**Free, and worth more than the first number, is the END of the last range.** That is the point where
the singing stops, and it is the second half of the feature rather than a footnote. A station can talk
over an outro exactly as it talks over an intro, and nothing else in this tree can tell it when the
outro begins.

**This is not a new idea and the trade has names for both markers.** Automation systems store the
vocal-start cue as an editable per-track marker (one calls it the ramp, sitting beside outro, fade-out
and start-next; another places its talk markers in PAIRS, a start and an end, and will not let you
place one alone). The presenter's phrase for using it is talking to the post. Two things follow from
the fact that every professional system models this as an editable pair rather than a derived number:
**the pair is the unit**, and **an operator override is expected**. The override matters more than it
looks, and the guard it needs has been paid for elsewhere on exactly this shape of column: every walk
revisits every track, so an override an automatic writer can clobber is one the next pass silently
undoes, and the refusal has to live in the writer's own WHERE clause rather than in the caller. The
nearest thing this tree has is the schedule's manual takeover in `0017_schedule.sql`, which holds
until the next slot begins rather than being stomped, and it is the same lesson one subsystem over.
If a derived onset gets an override column, the writer must refuse to touch a row an operator has set,
and clearing the override has to return the track to the automatic pipeline rather than pinning it to
"unknown".

**Return a tri-state, not a number.** Instrumental, or ranges, or "cannot say". The third is the one
this file was missing: a track with unsynced plain text has lyrics and no timings, which is neither an
instrumental nor an answer, and it must read as "fall back" rather than as zero. That shape also makes
the fallback explicit at the seam instead of hidden inside a `min()`.

**An instrumental sometimes arrives disguised as words.** LRC carries an `[au: instrumental]`
metadata tag that some tooling surfaces as a lyric line, and a lone "Instrumental" placeholder body is
common. Both are instrumental markers rather than sung words and must be recognised as the former.
Anchor that test to the WHOLE line, or a song that merely sings the word gets classified as having no
words at all.

**One thing to take deliberately in the opposite direction.** The comparable implementation uses the
lyric to REPLACE its detector rather than to narrow it, and its argument is measured and good: source
separation never separates cleanly, so an instrumental's vocal stem carries bleed (pad swells,
cymbals, guitar harmonics) that a self-relative energy gate reads as singing, which produced a
false-positive across a whole library. Against that, a typed timestamp is ground truth. **Do not copy
that here.** The measurement in this file says the timestamps are not ground truth on this catalog:
12 of 52 first lines land under three seconds and 6 under one. Their conclusion is right about their
inputs and ours is right about ours, and the difference is worth stating rather than splitting: where
this tree has both a lyric and a measured cue point, the lyric NARROWS the measured one and is floored,
and where it has only a lyric, the tri-state above says whether there is an answer at all.

## What this station's catalog actually looks like

Measured 2026-09-02, and it moves the plan, so it goes above the provider table rather than below it.

**Every record here comes from one provider.** `track_sources` holds 782 rows and all 782 name the
same plugin. No library-shaped source is installed. That matters because the original plan below made
the operator's own library the first plugin, on the argument that it involves no third party and no
terms to accept. That argument is still correct and currently has nothing to read: there is no
library on this install to ask. **A library plugin is not the first phase, it is the phase that
arrives with the first library.**

What the catalog does have is good matching material: 766 tracks, every one of them carrying a
`duration_ms`, 751 with an mbid, and an ISRC on every one of the 782 source rows. Duration is the
disambiguator the auth-free source keys on and ISRC is the one the licensed source prefers, so
neither is short of a key.

## Where lyrics come from

Re-checked live on 2026-09-02, endpoint by endpoint, including reading the matching code of the one
that publishes it. The interesting differences between these sources are in their terms rather than
in their JSON, which is why two of the rows below changed.

| Source | Auth | Shape | Notes |
| --- | --- | --- | --- |
| LRCLIB | none | plain and synced, an instrumental flag, and a per-line `start_ms`/`end_ms` document; matched on artist, title, album and duration | **The first plugin**, on measurement rather than on argument. See below |
| The operator's own library | already configured | Subsonic `getLyrics` / OpenSubsonic `getLyricsBySongId`, plus whatever is embedded in the files (ID3 `USLT`/`SYLT`, Vorbis `LYRICS`/`UNSYNCEDLYRICS`) | Still the cleanest source when one exists: no third party, no rate limit, no terms, and the lyric is one the operator's own files carry. There is no library on this install, so this is not first any more |
| lrcmux | none | an AGGREGATOR: one call fanned out over several upstreams, best result picked and cached | The second source, replacing Musixmatch in that slot. MIT, self-hostable, and it buys several upstreams for one integration. See below |
| The word-level TTML database | none | syllable-level timings, keyed by streaming-platform id, as files rather than as an API | Not a source. A phase 3 REFINEMENT for the records it covers, and the only thing that answers the error bar this file measures. See below |
| Genius | API key, OAuth2 | **lyric text in FRAGMENTS, and no whole lyric** | The 2026-08-16 row said "no lyric text at all" and that was wrong in the direction that matters. Corrected below |
| Musixmatch | API key | licensed, with a free non-commercial tier; **plain lyrics on the free tier, everything time-synced behind the paid one** | The licensed option. Better engineered than this file assumed and still not the one to build first. Corrected below |
| Spotify | n/a | not in the Web API | Their in-app lyrics are licensed from a third party and are not exposed. `plugins/spotify` cannot answer this question |

### LRCLIB, measured

60 tracks drawn at random from this station's catalog, asked for by artist, title, album and duration:

| | |
| --- | --- |
| matched | 59 of 60 |
| matched on the FIRST, strictest attempt | 59 of 59 |
| synced | 52 |
| plain only | 7 |
| instrumental | 0 |
| missed | 1 |

The second row is the surprising one. Three progressively looser fallbacks were implemented and none
of them was ever reached, including for the re-issue decorations that `match.text.ts` exists to
survive: a title reading `Two Tickets to Paradise (2022 Remaster)` matched against an album reading
`Eddie Money (2022 Remaster)` on the first try, as did `Resolution (Exclusive Edition)`. The reason
is worth keeping, because it will not hold for every source: their contributors tag from the same
catalogs the station's own provider does, so the decorations agree. A source populated from
elsewhere would need the `baseForm` ladder.

**Its mechanics, read from its own source rather than guessed:**

- The match is exact on lowercased track name and artist name, `duration` within **±2.0 seconds**
  when supplied, album exact when supplied, `LIMIT 1`. Send the duration always. Every track here has
  one, so the strict form is never unavailable.
- **It cannot take an ISRC or an mbid.** The 751 mbids and 782 ISRCs buy nothing here. This is the
  one source where the station's best identifiers are useless and its weakest ones are the key.
- Clients are required to identify themselves with a `User-Agent` naming the application, its
  version and a link to it (`X-User-Agent` and `Lrclib-Client` are accepted alternatives), and the
  service answers `429` with `Retry-After` when a client exceeds its limit. That maps onto a
  `permissions.network` entry with `ratePerSecond` and a shared bucket, and onto the `Retry-After`
  handling the host already does.
- The response carries a per-line document with `start_ms` AND `end_ms`, which is richer than the
  `[{ atMs, text }]` this file originally anticipated. Store the end offsets; the last line's end is
  a free answer to "when does the vocal stop", which is the other half of a talk-up and is not
  otherwise cheap.
- **The server is MIT-licensed and it publishes database dumps.** An operator who does not want a
  third party in the path at runtime runs their own copy and points the plugin's `fromConfig` base
  URL at it. That is the same posture as the measurement sidecar, and it is the strongest single
  argument for this source over any of the others: it is the only one that can be removed from the
  network entirely.
- Its rights position is unstated rather than cleared, and the lyrics are community-contributed.
  That is an operator's call and it belongs in the plugin's config copy, not in a comment.

### lrcmux, the second source

An aggregator rather than a database: one request fans out across several upstreams, the best answer
is picked, and everything is cached. MIT, written in Go, and it self-hosts the same way the primary
source does (a compose stack of API, frontend and a cache, or the binary, or a hosted deployment),
with a public instance available for an operator who does not want to run one. Its provider ids
include the large streaming catalogs whose lyrics are otherwise unreachable from here.

It takes the phase 4 slot for a plain reason: **the alternative in that slot is one integration for
one upstream, and this is one integration for several.** It also fails in the right direction, since
an aggregator that loses an upstream degrades rather than stops. What it does not do is remove the
matching problem, which is the same names-and-duration problem the primary source has, one layer
further away from the answer.

### The word-level database, and why it is not a source

Community-submitted TTML with per-syllable timings, organised as one folder per streaming platform,
each file named by that platform's track id, with a per-platform `index.jsonl` and a combined raw
index. There is no API; a lookup is a raw file fetch by id. Contributor-written portions are CC0.

It is in this file for one specific reason. **Every record here carries a streaming-platform id
already**, so this is the one source that can be keyed by an identifier that cannot match the wrong
record, and the one that answers the measured error bar: it times WORDS, and the gap between the
first line and the first word is the entire problem under the vocal onset. Where it has a record, its
onset needs no floor and no safety margin.

The catch is coverage, and it is decisive: it is community-submitted and weighted heavily toward
catalogs this station's library is not drawn from, so most records here will not be in it. That makes
it a refinement applied where it hits and never a source anything falls back to. Treat a hit as
strictly better than a line-timed onset and a miss as ordinary.

### Genius, corrected

The 2026-08-16 row said the API returns no lyric text. That was wrong, and wrong in the direction
that creates work rather than saves it. `GET /songs/:id` returns the song's referents "including the
text to which they refer", and each referent carries the highlighted `fragment` plus
`context_for_display.before_html` and `after_html`, which their own documentation suggests populating
with up to 200 characters each. On a song document those spans are lyric lines. So the API does hand
over copyrighted lyric text, sanctioned and in fragments, just never the whole song.

The correction does not change the verdict for lyrics, it changes the verdict for ANNOTATIONS, which
this file had filed away as clean prose belonging to `fact-enrichment.md`. They are not clean. An
annotation cannot be handed to the claim extractor without handing it the lyric line the annotation
is attached to, and the floor extractor takes an opening span verbatim. The annotation path inherits
this file's hazard rather than escaping it. `fact-enrichment.md` now carries this under its
"Deliberately not built" list, where the Genius bullet sits.

Two further facts settle whether any of it is available at all:

- **Commercial use of the API is not allowed without a licence.** That is the first sentence of their
  getting-started page, above authentication and before any endpoint.
- **There is no separate API agreement.** The TOS link in the API documentation's own navigation
  resolves to the site terms, whose clauses prohibit scraping and data mining, prohibit reproducing
  their content for commercial purposes, and name AI and machine-learning use specifically as
  requiring signed written consent. Their `robots.txt` disallows the AI crawler user-agents from the
  whole site. Scraping the pages, which is the only way to get a whole lyric out of them, is refused
  in writing rather than merely unaddressed.

Everything else about the API is metadata: annotations, referents, songs, artists, web pages, a
search taking a bare `q` with no artist or duration field, and an account endpoint. If it were ever
used, a client access token covers every read-only endpoint so no OAuth flow is needed,
`text_format=plain` must be passed explicitly because the default is a DOM tree, and no rate limit is
documented anywhere, so a plugin could only guess at an honest one.

### Musixmatch, corrected

Better than this file assumed on every axis except the one that decides it. The 2026-08-16 row's
"roughly a third of the lyric" is **not stated anywhere in the current documentation** and could not
be verified without a key; what IS documented is a different mechanism, where restricted content
comes back with an empty `lyrics_body` and a `lyrics_copyright` string saying they are not authorised
to show it, driven by artist-level, worldwide or per-country restrictions.

The tier split is the deciding fact:

| Endpoint | Tier |
| --- | --- |
| plain lyrics, snippet, track metadata, search, matcher, charts | free |
| **every time-synced endpoint** (subtitles, matched subtitles, character-level richsync) | paid |

**The vocal onset is the phase that pays for this feature and it is the one thing the free tier
cannot answer.** Paying for it means paying for what LRCLIB already gives on 52 of 60
records here.

The second problem is structural rather than commercial. Their documentation states that usage must
be tracked whether the catalog is reached by API or by feed, and both implementations it offers are
display artifacts: a script tag, or an image pixel. The go-live checklist adds showing the
`lyrics_copyright` value on the page, showing a "powered by" image linked to a `backlink_url`, and
disabling copy-and-paste for traffic from Japan. **Every one of those obligations is conditioned on
displaying lyrics, which this station by design never does.** So they are simultaneously
inapplicable and unsatisfied. That is not a thing to design around. It is a question to ask their
sales address before writing a line of code, and the answer determines whether the plugin can exist
rather than how it is shaped.

Their self-serve terms are headed as applying to non-commercial use only, with commercial use routed
to sales. For one operator running one station that is probably fine; for a station somebody else
runs it is an operator determination and belongs in config copy. They also say their team may
contact an integrator to review the implementation against their content policy.

**It has also lost the phase 4 slot** to an aggregator that is free, self-hostable and buys several
upstreams for one integration. What is left for Musixmatch here is the labels question below, which
is a different purchase entirely.

The matching, for the record, would be better than LRCLIB's: they recommend ISRC as the
primary key with artist and title as the fallback, their matched-subtitle call takes a duration with
an explicit maximum deviation, and their track metadata call returns `instrumental`, `explicit`,
`has_lyrics`, `has_subtitles` and `has_richsync`, so one cheap call says what exists before anything
is fetched. `explicit` there is a second advisory source and falls under the same trap as a
lyric-derived one: its own field, never written over `track_sources.advisory`.

### The thing worth reopening later

Their Analysis API returns a song's meaning, moods, themes, moderation categories and content rating,
per track, keyed by ISRC. **That is phase 5 of this file sold as a finished product, and it returns
the derived labels INSTEAD of the lyric text.** Taking it would mean never storing a lyric at all,
which does not work around the constraint at the top of this file so much as make it moot. There is
also an endpoint that detects copyrighted lyrics inside an arbitrary text string, which is the phase
6 echo check as a service.

Neither carries a tier badge and the pricing page is client-rendered, so what either costs is
unknown. The question to ask at phase 5 is therefore not "can we get lyrics" but **"can we buy the
labels and skip holding the text"**, which is a better question than this file originally asked.

## The shape

**A `lyrics` capability of its own, not a field on `TrackEnrichment`.** Four reasons, and the first
two are the ones that would bite:

1. **The merge is wrong for it.** `enrichment.merge.ts` resolves text fields last-wins by priority
   and accumulates lists. A plain lyric from the library and a synced lyric from a second source are
   not a conflict for a priority order to settle: they are two different artifacts and the station
   wants both.
2. **The payload goes to the wire.** A `TrackEnrichment` field lands in `track_enrichment.data` and
   is served by `enrichment.read.service.ts`, so it would need a second `forTheWire` exclusion and
   would be one careless read away from a console panel nobody decided to build.
3. **The caps do not fit.** `MAX_TEXT` is 2,000 characters and `MAX_BIOGRAPHY` is 20,000. A lyric
   sits between them and would need its own cap regardless, which is a field that is not really a
   field.
4. **The lifetime is different.** An enrichment payload is refreshed against a changing upstream. A
   lyric, once right, is right permanently, and what gets re-run is the DERIVATION over it.

So: `deadair.track_lyrics`, one row per track per provider exactly as `track_enrichment` is, holding
the plain text, the synced lines as jsonb, a language, an `instrumental` boolean and the fetch
provenance. Hold each line as `{ atMs, endMs, text }` rather than the `{ atMs, text }` originally
sketched, because the source that matters publishes the end offsets and the last line's end answers
"when does the vocal stop" for free.

The DERIVED vocal ranges are not that row. They are a function of it, cheap to recompute, and they
change when the constants above are tuned, so computing them on read costs nothing and storing them
invites a stale copy. What DOES want storing beside them is an operator override of the two markers,
for the reason the marker section gives: every walk revisits every track, so an override an automatic
writer can overwrite is one the next pass silently undoes. One nullable pair, and the writer refuses
any row where it is set.

The derived labels are a separate concern on their own row with a `schema_version`, borrowing the
trick `track_analysis` already uses: a row written by an older prompt reads as STALE rather than as
missing, so re-deriving the whole catalog under a better prompt is an ordinary pass instead of a
migration. And it needs `fact_extractions`' lesson too, which is that a derivation that produced
NOTHING has to be recorded as having happened, or the walk reads the same dead lyric every fifteen
minutes for the life of the install.

## Things to get right when it lands

- **Matching is the silent failure.** A lyric matched on artist and title alone is wrong often
  enough to matter, and nothing announces it: a wrong lyric yields a confident wrong vocal onset and
  a confident wrong set of labels. Duration is the disambiguator every lyric service keys on for
  this reason, and the strictness argument is the one `pick-artist-matching.md` makes: a near miss
  does not error, it produces the wrong record while the console says otherwise. The measurement
  above is not evidence against this. It is evidence that the strict form SUCCEEDS often enough that
  there is no reason to ever loosen it.
- **A provider that refuses an unattended client presents as an empty library, not as an error.**
  The established tool in this space excludes two of its own configured sources by DEFAULT because
  they block its user agent, which is the failure this station is worst at noticing: a walk that
  completes, a count that stays at zero, and nothing in the log that reads as broken. Any source
  added here needs its first refusal to be loud. A source that answers `403` to a declared client is
  a source that is not installed, and the console's counts are the only place that distinction will
  ever be visible.
- **Installed must not mean airing differently.** Every switch here is off by default, the same
  posture as `llm.setGenerator` and `llm.factExtraction`, and the talk-up read is the exception
  worth arguing about rather than assuming.
- **The lyric never reaches a prompt that a floor writer also sees.** The deterministic writers are
  the thing that cannot fail, and they are the thing that should be incapable of quoting.
- **Nothing here is a fact.** Repeating it because it is the mistake with the worst outcome and the
  shortest path: the extraction service is one function call away from any prose the host holds.

## Phases

Each leaves the tree working and is one commit. The order changed on 2026-09-02: what was phase 2 is
now phase 4, because it needs a library this install does not have.

1. **The capability and the store.** `capabilities/lyrics.ts`, `deadair.track_lyrics`, the boundary
   classification, and the `forTheWire` exclusion written at the same time as the read. No consumer,
   no behaviour change.
2. **The LRCLIB plugin**, with the User-Agent it requires, the rate limit and `Retry-After` it
   publishes, a `fromConfig` base URL so an operator can point it at their own copy, and the strict
   artist/title/album/duration match with no looser fallback. A walk fills the table. The console
   reports counts only: how many records have a lyric, how many are synced, how many are
   instrumentals. No text on the wire.
3. **The two markers.** Derive vocal ranges from the synced lines per the marker section above and
   publish the pair: the first range's start narrows the talk-up limit as
   `min(introEnd, vocalOnset - safety)`, **floored**, with a first line under a second or two read as
   a bad transcription rather than as a record with no intro; the last range's end is the point the
   singing stops, which nothing else in this tree can answer. Tri-state at the seam, so unsynced text
   reads as "cannot say" rather than as zero. No model, and this is the phase the file is worth
   building for. The word-level database is a refinement INSIDE this phase, not a phase of its own:
   where it has the record, the onset arrives per-syllable and needs neither the floor nor the safety
   margin.
4. **The library plugin, when there is a library.** Over whatever library-shaped source gets
   installed. It has no third party, no rate limit and no terms, so it takes priority over LRCLIB
   wherever it can answer. It is not earlier in this list only because nothing on this install can
   answer it. **Four things about that call are easy to get wrong and all four have been paid for
   already elsewhere.** The plain lyrics call FLATTENS structured lyrics to text and discards the
   per-line timings, which are the entire point, so the call to make is the by-song-id one and the
   field to read is the structured list. A track may carry several structured entries (languages, a
   synced one and an unsynced one), so pick the synced entry rather than the first. Each entry
   carries a global `offset` whose sign is counter-intuitive, since positive means the lyrics appear
   SOONER, making the effective start `start - offset`, clamped at zero. And an older server answers
   the legacy single-value shape instead, which is plain text and has no timings at all.
5. **Derived labels**, off by default, with the schema version and the produced-nothing mark. Wire
   them to one consumer only, and the honest first one is a never-play predicate rather than mood
   steering, because a predicate is checkable and a mood is a matter of taste. Ask the buy-the-labels
   question here before writing a prompt. **Nothing in this space has prior art**: a search for a
   self-hosted station deriving never-play predicates or mood labels from lyrics found no
   implementation at all, and the only thing occupying the ground is the licensed product above. Every
   other phase in this list can be checked against somebody's working code. This one cannot, which is
   an argument for wiring it to one checkable consumer first rather than a reason to skip it.
6. **The DJ knowing the subject**, with the echo check against the lyric text and the labels
   preferred over the words. Last, deliberately.

A console lyrics panel is not on this list and is not scoped. It is the one use where the text
itself leaves the machine, and it should be decided on its own rather than arrive as the tail of a
feature justified by a talk-up limit.

## Related

- [fact-enrichment.md](fact-enrichment.md) for the `SourceDocument` path this file exists to stay
  off, and for the floor extractor that makes staying off it structural rather than a matter of
  care. **It carries the annotation finding above**: an annotation arrives welded to the lyric line
  it annotates, so the annotation path inherits this file's hazard rather than escaping it.
- [track-analysis.md](track-analysis.md) for `vocal_onset`, its one consumer, and the beat layer this
  does not replace.
- [station-moment.md](station-moment.md) and [never-play-rules.md](never-play-rules.md) for the two
  consumers of derived labels. The second was `station-intelligence.md` §5 and was rescoped out of it
  on 2026-08-19; it is also where the "own field, never written over `track_sources.advisory`" trap
  is recorded from the other side.
- [pick-artist-matching.md](pick-artist-matching.md) for what a near-miss match costs when nothing
  errors.
- `docs/decisions/analysis-licensing.md` for the shape of the licence argument this file makes a
  different version of: there the rule was about what enters the analysis path, here it is about
  what leaves the station's mouth.
