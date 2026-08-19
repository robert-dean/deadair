# Deferred: lyrics as enrichment, and the one thing they may never be used for

**Written:** 2026-08-16, from "add track lyrics as enrichment".
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

Everything below is what lyrics ARE for, given that.

## Four uses, and they are not equally worth building

| Use | Needs a model | Text ever leaves the row | Worth |
| --- | --- | --- | --- |
| Vocal onset for the talk-up limit | no | no | high, and cheap |
| Derived labels (subject, explicitness, language, season) | yes | no | high, and the reason to keep the text |
| The DJ knowing what a song is about | yes | into a prompt | real, and the only risky one |
| A lyrics panel in the console | no | yes | not scoped here |

**The vocal onset is the one that pays for the feature**, and it needs no intelligence at all.
`track-analysis.md` defers a beat layer whose `vocal_onset` field has one consumer, the talk-up
limit, and the four measured cue points only approximate it: `introEnd` is "the beat established, OR
the vocal in", which is a detector's guess about two different events. A synced lyric already
carries the answer as a timestamp somebody typed while listening, and it arrives with no decoder, no
model, and none of the licence exposure that made `docs/decisions/analysis-licensing.md` necessary
(the toolkits that do vocal separation are largely copyleft; a `[00:12.40]` is a number).

Three things keep that honest and all three belong in the code that reads it:

- **The first timestamp is the first LYRIC LINE, not the first vocal.** A transcriber times an
  ad-lib, or times a line a second early so a singer can follow it. Treat it as a hint with an error
  bar of a second or two, and take `min(introEnd, vocalOnset - safety)` rather than replacing one
  with the other. The failure to design against is a talk-up that runs over the first word, which is
  the single most audible mistake a radio station makes.
- **An instrumental is a real answer, not a miss.** A source that says "this record has no words"
  (LRCLIB has an explicit flag for it) is telling the talk-up limit to fall back to `introEnd`
  deliberately, which is different from having never looked.
- **Most of the library will have no synced lyric**, so this can only ever narrow the limit where one
  exists. It is not a replacement for the beat layer and does not make `track-analysis.md` smaller.

**The derived labels are what makes the text worth keeping.** What a song is ABOUT is not in any
metadata field anyone sells, and it is what two deferred features are short of:
`station-moment.md` wants a mood vocabulary that something can actually match a record against, and
`never-play-rules.md` wants never-play predicates an operator can state ("nothing about
Christmas in July", "nothing explicit before nine"). The split is the one `fact-enrichment.md`
already made and named: **a plugin fetches, the host thinks.** The durable artifact is the labels,
not the lyric, which means an operator who is uneasy about holding the text can be given a switch
that drops it once the labels are derived, and nothing downstream notices.

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

## Where lyrics come from

All of this is from memory and checked against nothing live on 2026-08-16. Verify before building,
which is this directory's own rule and matters more here than usual, because the interesting
differences between these sources are in their terms rather than in their JSON.

| Source | Auth | Shape | Notes |
| --- | --- | --- | --- |
| The operator's own library | already configured | Subsonic `getLyrics` / OpenSubsonic `getLyricsBySongId`, plus whatever is embedded in the files (ID3 `USLT`/`SYLT`, Vorbis `LYRICS`/`UNSYNCEDLYRICS`) | **The first plugin.** `plugins/navidrome` already speaks Subsonic 1.16.1 and already enriches. There is no third party, no rate limit, no terms to accept, and the lyric is one the operator's own files carry. The same argument that made the Apple feed the first chart plugin |
| LRCLIB | none | plain and synced, plus an instrumental flag; matched on artist, title, album and duration | The only auth-free source that serves SYNCED lyrics, which is the whole of the talk-up use. Community-contributed, and its rights position is unstated rather than cleared: that is an operator's call and belongs in the plugin's config copy, not in a comment |
| Genius | API key | **no lyric text at all** | Worth writing down because `todo.md` has "integrate with genius for enrichment" and it is not a lyrics integration. The API returns metadata and annotation anchors; the words are only on the page. What Genius genuinely offers this tree is ANNOTATIONS, which are third-party prose about a record and therefore a real `SourceDocument` candidate for `fact-enrichment.md`, on a different path from this file |
| Musixmatch | API key | licensed, and the free tier returns roughly a third of the lyric with a mandatory tracking callback | The licensed option, with commercial terms and a snippet that is useless for a vocal onset and marginal for labels |
| Spotify | n/a | not in the Web API | Their in-app lyrics are licensed from a third party and are not exposed. `plugins/spotify` cannot answer this question |

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
the plain text, the synced lines as jsonb (`[{ atMs, text }]`), a language, an `instrumental`
boolean and the fetch provenance. The derived labels are a separate concern on their own row with a
`schema_version`, borrowing the trick `track_analysis` already uses: a row written by an older
prompt reads as STALE rather than as missing, so re-deriving the whole catalog under a better prompt
is an ordinary pass instead of a migration. And it needs `fact_extractions`' lesson too, which is
that a derivation that produced NOTHING has to be recorded as having happened, or the walk reads the
same dead lyric every fifteen minutes for the life of the install.

## Things to get right when it lands

- **Matching is the silent failure.** A lyric matched on artist and title alone is wrong often
  enough to matter, and nothing announces it: a wrong lyric yields a confident wrong vocal onset and
  a confident wrong set of labels. Duration is the disambiguator every lyric service keys on for
  this reason (LRCLIB within a couple of seconds), and the strictness argument is the one
  `pick-artist-matching.md` makes: a near miss does not error, it produces the wrong record while
  the console says otherwise.
- **Installed must not mean airing differently.** Every switch here is off by default, the same
  posture as `llm.setGenerator` and `llm.factExtraction`, and the talk-up read is the exception
  worth arguing about rather than assuming.
- **The lyric never reaches a prompt that a floor writer also sees.** The deterministic writers are
  the thing that cannot fail, and they are the thing that should be incapable of quoting.
- **Nothing here is a fact.** Repeating it because it is the mistake with the worst outcome and the
  shortest path: the extraction service is one function call away from any prose the host holds.

## Phases

Each leaves the tree working and is one commit.

1. **The capability and the store.** `capabilities/lyrics.ts`, `deadair.track_lyrics`, the boundary
   classification, and the `forTheWire` exclusion written at the same time as the read. No consumer,
   no behaviour change.
2. **The library plugin.** `plugins/navidrome` implements it over `getLyrics`, and a walk fills the
   table. The console reports counts only: how many records have a lyric, how many are synced, how
   many are instrumentals. No text on the wire.
3. **The vocal onset.** The talk-up limit takes `min(introEnd, vocalOnset - safety)` where a synced
   lyric exists. No model, and this is the phase the file is worth building for.
4. **A second source** for the records the library cannot answer for, behind an operator switch,
   with the duration-keyed match rule and the terms named in the config copy.
5. **Derived labels**, off by default, with the schema version and the produced-nothing mark. Wire
   them to one consumer only, and the honest first one is a never-play predicate rather than mood
   steering, because a predicate is checkable and a mood is a matter of taste.
6. **The DJ knowing the subject**, with the echo check against the lyric text and the labels
   preferred over the words. Last, deliberately.

A console lyrics panel is not on this list and is not scoped. It is the one use where the text
itself leaves the machine, and it should be decided on its own rather than arrive as the tail of a
feature justified by a talk-up limit.

## Related

- [fact-enrichment.md](fact-enrichment.md) for the `SourceDocument` path this file exists to stay
  off, and for the floor extractor that makes staying off it structural rather than a matter of
  care.
- [track-analysis.md](track-analysis.md) for `vocal_onset`, its one consumer, and the beat layer this
  does not replace.
- [station-moment.md](station-moment.md) and [never-play-rules.md](never-play-rules.md) for the two
  consumers of derived labels. The second was `station-intelligence.md` §5 and was rescoped out of it
  on 2026-08-19; it is also where the "own field, never written over `track_sources.advisory`" trap
  below is recorded from the other side.
- [pick-artist-matching.md](pick-artist-matching.md) for what a near-miss match costs when nothing
  errors.
- `docs/decisions/analysis-licensing.md` for the shape of the licence argument this file makes a
  different version of: there the rule was about what enters the analysis path, here it is about
  what leaves the station's mouth.
