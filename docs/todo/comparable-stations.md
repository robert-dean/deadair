# What a comparable station does that this one does not

**Written:** 2026-08-22, after reading another self-hosted station of the same shape end to end:
Icecast and Liquidsoap in containers, a Node brain above them, a Subsonic library, a local model, a
local speech engine, a Python analysis sidecar. Close enough to this tree that almost every finding
lands on a seam that already exists here.

**Revised:** 2026-08-22, after a second pass over the same station's published operator manual and
its community pages rather than its source. The counts below describe the first pass and are left as
they were; the second pass is its own section, near the bottom, and it changes the ordering at the
end.

**Revised again:** 2026-08-27, after a third pass over the same station five days later, which is
long enough for it to have cut two releases. That pass is its own section too, and it does two things
the others did not: it CORRECTS a claim made here, and it records a bug this tree had that the survey
missed because it was looking for missing features rather than for wrong ones.

**Fourth pass:** 2026-08-28, which applied the third pass's closing lesson as a method rather than
reading it as a conclusion. It asked four questions of this tree and measured every answer, so two of
its four findings are numbers showing there is nothing wrong. It also corrects a claim the third pass
made here about artist name-variant folding.

**Status: three of these are built now, and the rest is still a survey.** It was written down for the reason
[stream-server-alternatives.md](stream-server-alternatives.md) is: the pass was done once and should
not have to be done again. The findings are stated on their own terms rather than as a comparison,
because a reference to somebody else's tree dates badly and cannot be checked by whoever reads this
next. Where a number appears it was measured **on a library that is not this one**, and every one of
them says so.

**The short version: most of this is already here.** Of the fourteen things worth taking, nine are
already built or already designed in this directory, and for those the value of this file is the
evidence and the re-ranking rather than the idea. Five are genuinely absent, and three of those five
are operator surfaces rather than anything a listener would hear.

---

## Where the two stations spent their effort

Worth stating plainly, because it explains the shape of the gap and stops this file reading as a list
of things to catch up on.

The other implementation is a **listener product**. Its hard-won engineering is at the audience seam:
the offset between the live edge and what a listener actually hears, per-browser codec gating, the
safety rules around a stranger's song request, six player faces, native apps. It has no editable
forward running order at all: a queue plus a weekly grid, with the next record chosen a couple of
minutes before it plays.

This station is an **editorial system**. The director owning one running order, a brief and a period
as columns on it, a claim that cannot exist without the quote that supports it, an opinion at three
levels, a persona that accumulates, one row per write attempt. Nothing here is aimed at a stranger.

That divergence is why the gaps below cluster so tightly into two piles: **how the station sounds
between records**, and **what the operator can see**. It is also why several things the other station
has are listed at the bottom as deliberately unwanted rather than deferred.

Two places this tree is ahead are worth recording, because both were arrived at the hard way and
should not be traded away for anything in the list below. **A record is not committed until its audio
is local** ([bytes-before-air.md](../decisions/bytes-before-air.md)) removes a whole class of fault
the other station instead detects after the fact, with a probe id per handover and a telnet query to
find out whether the thing it pushed ever resolved. And **a claim with no source is not
expressible**, where the comparable station reached the same problem from the other end and added an
abstain rule after a web search made its host invent facts on air.

## What already has a home here

Nine of the fourteen. Each line is what the other implementation actually does, then where this tree
already keeps that question. Nothing in this section needs a new file.

| The thing | Where it lives here |
| --- | --- |
| Crossfades sized per boundary from measured cue points | **Built.** [crossfades.md](crossfades.md), the plain rung, `crossfade.ts` |
| A vocal onset so the DJ stops talking before the singing starts | Deferred twice: the beat layer in [track-analysis.md](track-analysis.md), and a synced lyric's first timestamp in [track-lyrics.md](track-lyrics.md) |
| Moods as a selection axis | Deferred and **blocked** in [station-moment.md](station-moment.md): `EnrichedTrack.moods` exists and nothing populates it. See the next section, which is about unblocking exactly this |
| A model budget with graded degradation | Deferred in [station-intelligence.md](station-intelligence.md) §2, against its own ordering claim, with the reasoning kept |
| Per-episode produced shows (an angle, a beat per hour, an intro and an outro) | **Built** 2026-08-16, [produced-episodes.md](produced-episodes.md) |
| A second voice trading lines with the host inside one segment | Deferred: the cast, [produced-episodes.md](produced-episodes.md) §4. `OutlineBeat.lead` and `Production.voices` exist and nothing reads them |
| An instrumental bed the DJ talks over between records | Half built: the audio path exists, nothing writes or speaks one ([director-and-lineups.md](director-and-lineups.md) §2) |
| An hourly archive of what went out | Deferred in [stream-formats.md](stream-formats.md), including the rule that it should follow the lease rather than run unconditionally |
| Listener requests, and accountless listener likes keyed by an HMAC of the address | Deferred in [station-intelligence.md](station-intelligence.md) §7, which already reaches the same accountless design |

Two of those deserve a note rather than a row.

**The fade should be shaped by how a record ENDS**, which is the one part of the transition question
this tree has not asked. The boundary length here is `min(outgoing.outro, incoming.intro)`, both
measured, which is already better than a fixed number. What the other station does on top is vary the
**shape** by ending type: a record that genuinely fades out rides eight to twelve seconds, a cold
ending cuts at four, and the choice between them comes from the loudness difference between the body
of the track and its tail, with the result snapped to whole bars from the tempo. That needs two
fields the sidecar does not return: it is at `SCHEMA_VERSION = 1` with four cue points and the
loudness layer, and no tempo, no downbeats, no vocal anything. So this is not a fifth rung on the
[crossfades.md](crossfades.md) ladder, it is **the beat layer in
[track-analysis.md](track-analysis.md), which two other files are already waiting on**, and the
talk-up limit rides with it for free. That is the re-ranking: three deferred entries in this
directory are one measurement pass.

**The archive has two details worth stealing wholesale**, both of which cost a line each and are
annoying to discover later: it follows the lease (already the stated rule here), and the recordings
have to be excluded from the library walk, or a station with a co-located library ingests its own
output and eventually plays it back.

## The one that unblocks a blocked file

[station-moment.md](station-moment.md) says mood-biased selection is blocked on data nobody has:
`EnrichedTrack.moods` exists, nothing fills it, and the MusicBrainz plugin explicitly declines to.
The proposed source is tags, which means a library is only as steerable as somebody else's
folksonomy.

The other implementation gets that data from the **audio** instead: a joint text-and-audio embedding
per record, scored against a mood vocabulary written in words, plus nearest-neighbour lookup in the
same space. That is a real answer to "nothing populates it", because it needs no tags and no
upstream at all, and it would give this station a timbral axis it has nowhere else.

**The trap is measured and it is the reason to write this down.** Similarity scores from that kind of
model are **not comparable across different prompts**. On an 11k-track library that is not this one,
scoring every track against every mood and taking the top scores per track produced `energetic` on
61.7% of the library and `rainy` on 43.5%, against `calm` at 0.9% and `spiritual` at 0.2%. Ranking
raw scores ranks the *prompts*, not the tracks. The fix is a per-mood baseline over the whole
library, mean and standard deviation, and then ranking on the z axis with the margin expressed in
standard deviations rather than in raw score. Two second-order details came out of running it, both
of which look like polish and are not:

- The minimum sample size for a baseline has to be applied **per mood, by pruning that mood**, not by
  gating the whole pass on the largest one. Gating reproduces the original bug one mood at a time: a
  thin new mood beside a fat old one wins every record.
- Ambiguity returns **null, never a middle bucket**. Bucketing an unclear result to "medium" replaces
  one guess with another and then calls it evidence. Null leaves the existing value alone, so
  mistuning costs coverage instead of correctness.

**What it would cost here is not small and should be counted before anyone starts.** There is no
vector column and no pgvector in the migrations. The sidecar would grow a second model, which puts it
straight into [analysis-licensing.md](../decisions/analysis-licensing.md), and the licence that
matters there is the **weights'**, which is not in the package metadata. And the embedding text has
one rule that has to be got right on the first pass: the tagger's own output must never be part of
what gets embedded, because the labels are derived *from* the vectors and feeding them back is
circular.

## The three the operator would feel, none of which exist here

These are the genuinely absent ones, and they are all about seeing the station rather than hearing
it. None is large.

**Nothing correlates one decision's calls.** A refill makes a model call, which makes tool calls,
which make provider calls, and the log lines from all of them sit next to whatever else was happening
in that second. The other station carries one id through the whole chain via `AsyncLocalStorage` and
writes append-only JSONL, so a single decision can be read back as a unit. The primitive is
**already in this tree**: `plugin.invocation.deadline.ts` uses `AsyncLocalStorage` to publish the
deadline a plugin reads through `host.remainingMs()`. The seam is that store, `LlmService`, and
`PluginInvoker`. The thing to keep from their version is that the writer **swallows its own errors**:
nothing reads these rows to decide anything, so a failed write must never cost the station the work
it was describing, which is the rule `ActivityRecorder` already follows here.

**Usage is per attempt and never adds up.** `script_history` carries `usage jsonb` and `duration_ms`
per write attempt, and `/scripts` shows them, which is genuinely more than the other station keeps
durably (it holds two 120-entry rings in memory and says so). What is missing is the aggregate: what
the model cost this week, which binding spends it, how long the speech engine takes per break and how
often it fails over. The speech side records no equivalent at all. This is the surface that makes
[station-intelligence.md](station-intelligence.md) §2's budget arguable rather than theoretical: it
is hard to argue about a cap without a number.

**Nothing assembles a station check-up.** There is `silence.diagnosis.ts`, the heartbeat map, the
activity feed, plugin statuses, the audience reading, the analysis backlog and the cache planner's
own answer, and a reader has to visit each one. The other station has a diagnostics sweep that
collects what the system already computes, section by section, and then hands the assembled report to
the model to review, answering with a severity, a summary and a list of priorities each carrying a
suggested fix that maps to a real admin endpoint. Two rules of theirs are the whole design and should
be copied exactly: **it adds no new probing infrastructure**, only readers of signals that already
exist, and **each section is individually guarded**, so one dead subsystem degrades its own row
instead of blanking the report. On this tree it would sit naturally beside the silence diagnosis and
would reuse its ordering, which is already causal rather than alphabetical.

## The small ones

- **A second scrobble destination.** ListenBrainz. Cheaper here than it looks: the `scrobble`
  capability, `deadair.scrobble_queue` and the send-after-commit design all exist, only `plugins/lastfm`
  implements it, and `plugins/musicbrainz` already carries a ListenBrainz client, its types and its
  entry on the host allowlist for enrichment. The work is a manifest capability and a submit call, and
  the two destinations must fail independently.
- **`.pls` and `.m3u` endpoints.** Two static text routes naming the mount. Hardware players, car
  receivers and most desktop players take a playlist file rather than a stream URL. This was pointless
  while the mount was on the LAN and stopped being pointless when it went behind a tunnel
  ([listening-loop.md](listening-loop.md)).
- **An MCP surface.** The other station serves one over HTTP off its own API, split into unauthenticated
  reads and admin actions. Here the contracts already generate a typed client, so the cost is mostly
  choosing which verbs an outside agent may reach and how they authenticate, which is
  [service-actors.md](service-actors.md)'s question wearing a different hat.

## The second pass, and why reading the manual found things reading the source did not

Everything above came from the code. The published operator documentation and the community pages
turned up six more, and they cluster differently because they are the parts of a station that only
show up once somebody has to explain it to an operator: an extension point, a way of looking at the
library, a column on a character, a document with no code in it, and two confirmations of calls
already made here.

**An operator can author a KIND of break there, and here only a developer can.** A kind is a
directory: a short brief in prose saying what to cover and when to stay quiet, frontmatter carrying a
cooldown, an optional cron and a declaration of which "right now" facts the writer may reference, and
optionally a small module that fetches live data and may decline before any words are written. The
words are still written at air time, around whatever is playing, which is the same split this tree
already makes between a phrasing and a script.

Every piece of that exists here and the operator can reach none of them. `segments.kind`,
`TopicKindRegistry`, `BreakWriterRegistry`, `clock_bands` and `BreakPromptShape` between them are the
whole mechanism, and adding a kind of break is a code change in five files. The argument for closing
that is their catalogue rather than their design: a two-line unrhymed poem about the moment, a note on
what taping music off the radio was like, a first-time-I-heard-this memory tied to the host's own
backstory. Not one of those needs code and not one of them would ever have been specified.

Two rules to copy exactly if it lands. The frontmatter's context list is `BreakPromptShape` written by
an operator instead of by a file, so it should BE that type rather than a second vocabulary beside it,
on `topics`' own argument: one list to keep straight instead of two and a mapping between them. And a
kind arrives **disabled** and is enabled by hand, which is what makes an authored kind and an imported
one the same object with the same guard. Note this is separable from the community exchange, which
stays in the section below: the exchange is distribution, and this is authoring.

**Nothing here draws the library as a shape, and the embedding axis is what would make one worth
drawing.** Theirs is a full-screen map of every measured record, placed by genre and lit by energy,
recolourable by confidence, loudness, pace or vocal presence, filterable by mood and band, with a
per-record dossier carrying tempo, key, moods, the nearest neighbours in embedding space and a
timeline showing where the intro ends, where the outro starts and where the singing is.

It is listed here rather than as a seventh finding because it is the inspection surface for the axis
above, and the calibration trap there is close to invisible without it. A mood that took 61.7% of a
library is a number in a report and an obvious stain on a map, and recolouring by CONFIDENCE is the
same argument the usage surface makes for the budget: it is hard to argue about a threshold without
seeing what it did. It also has nothing to draw until the axis exists, which is why it is not ranked
on its own.

**Chattiness is a property of the character there and a property of the station here.**
`deadair.personas` carries `brevity`, which is how long a break is, and `latitude`, which is how much
room the character is given. How OFTEN it talks is not on the row at all: it is `rotation.breaks` and
the format clock, station-wide, so nineteen characters share one setting. Theirs is a five-step
frequency per persona, from silent to relentless. Here that is one nullable column and a term in
`BreakPlanner`'s spacing walk, and it composes with the two already on the row for the reason those
two are separate rather than one field: a character that talks over every boundary and one that says
a line an hour are the same character at two settings, where a short break and a licensed one are two
different kinds of claim.

One bound has to be decided before it is built rather than after: whether the quietest setting reaches
silence. `rotation.breaks` off is already the way to stop the station talking, and a persona that can
switch itself off is a second switch that can disagree with the first, with nothing in a log saying
which one held.

**A licensing page, which is a document and not a feature.** Six questions answered plainly: the
software provides no music rights and is broadcast infrastructure in the way a mixer and a stream
server are; two rights are usually in play, the composition and the recording, administered by
different bodies in each country; non-commercial does not exempt a station, because the rule is about
public performance rather than about money; a private address is materially lower risk than a shared
one; and the ways to be unambiguously clear are original recordings, permissively licensed material,
or the public domain. It also gives an hourly archive a second reason for existing, which is that it
is the record.

That is worth taking because this tree is meant to ship for other people to run, so the question
arrives with the first stranger who runs it, and because it is the only item in this file with a
deadline that is not of our own choosing.

**Two confirmations, each of a call already made here.** The same model behaves differently through
different providers, because each one translates tools and structured output its own way, which is
`strayToolCall`'s finding reached from the other end and is the reason a model that works is one
measured on the route it will actually be called through rather than one chosen by name. And their
shelf of third-party players exists because the station serves an unauthenticated now-playing document
beside the mount: that is the cheap half of [now-playing-displays.md](now-playing-displays.md) and it
sits directly beside the `.pls` and `.m3u` entry in the small ones, since two static text routes and
one read-only JSON route are the whole of what makes a hardware player or a car receiver useful.

Their never-play rules take a seasonal window, which [never-play-rules.md](never-play-rules.md)
already specifies as `inSeason`, down to a `from > to` interval wrapping the year end. Recorded here
only because a second implementation reaching the same shape independently is evidence the shape is
right, not because anything is missing.

## The third pass, and the two things it corrected

Five days after the first two. The station in question shipped two releases in that window, which is
the first finding and the one that governs how the rest of this file should be read: **a claim here
about what the other implementation does NOT have goes stale faster than anything else in it.** What
it does, and why, holds. What it lacks was true on a Saturday.

**A correction: the station check-up IS built here, and this file said it was not.** `StationModule`
sits at the bottom of `modules.ts` reading the silence diagnosis, the running order, the library's
state and the plugin host, and `/checkup` in the console draws it. It was written after the first
pass and the survey was never revised, so the section above titled "the three the operator would
feel, none of which exist here" describes two. The two rules that section said to copy exactly were
both kept: it adds no probing infrastructure of its own, and each section is guarded separately.

**A bug this tree had, which the survey walked past twice.** The other implementation judges a
record's era through a resolver rather than through the raw year, because a reissue's own release
date is untrusted, and it hardened that guard again in this window against anthologies that carry no
compilation flag. Reading that as a feature comparison finds nothing: this tree has an era window,
it has been built for weeks, and `never-play-rules.md` even reaches the same seasonal shape
independently. Reading it as a QUESTION about our own data found a live fault.

The mechanism here is not theirs. The year sits on `deadair.tracks` and on `deadair.albums`, each
written at ingest from whatever payload created that row and neither ever overwritten, so a record is
dated by whichever release it was first SEEN through. A track first met on a reissue keeps the
reissue's year for good, while its own album row, filled later by another track off the original, has
it right. All three period surfaces read `coalesce(track, album)`, preferring the track's claim as
the narrower one, which is wrong in the one direction a period filter cannot afford.

Measured on this station's own library, 766 tracks and 630 albums: **41 records where the two levels
disagree, 33 of them with the track dated later.** Every one sampled was a reissue over an original
the album row already had. `All Along the Watchtower` at 2023 against `Electric Ladyland` at 1968,
`Purple Haze` at 1993 against `Are You Experienced` at 1967, `Tiny Dancer` at 1989 against `Madman
Across The Water` at 1971. A station asked for the seventies was refusing its own Hendrix and nothing
anywhere said so.

**Why it survived a measurement that was already done** is the part worth keeping. `MusicTrack.year`
in the plugin SDK carries a measured note saying reissue skew is real, rare and not a reason to
distrust the field: of 63 tracks whose title names a remaster year, 61 came through dated to the
original. That measurement is correct and it is about the wrong thing. It looked at what ONE provider
sends for one track, where the fault is the DISAGREEMENT between two rows written at different times
from different payloads, which nobody had queried. A measurement that answers a narrower question
than the one you have is worse than none, because it closes the question.

It is fixed: `modules/shared/release.year.ts` takes `least(track, album)`, the earlier claim, as one
exported fragment the draw, the resolver and the search tool all read. The counterexample is a bogus
LOW claim, and it is bounded where reissue skew is not: one album in that library carries the 1900
floor `usableYear` accepts, so its two tracks now read as 1900 records. A too-early year is a data
error with a validated floor under it, and a too-late one is the ordinary unmarked shape of every
remaster a provider sells. `era.smoke.ts` covers both directions.

**Three convergences, each one evidence rather than a gap.** In the same window the other
implementation aligned its daypart context, spaced artists out on its agent path with name-variant
folding, and shipped a dead-air trim on track edges. The first two are decisions already made here
and reached from the other end. The third is not, and its two rules should be in hand before the beat
layer at rank 2 below is started, because both look like polish and are not: silence has to be
measured against an ABSOLUTE floor rather than the track's own loud level, or a quiet intro reads as
silence and the cut eats music; and a trimmed head moves every timestamp measured from byte zero
while a trimmed tail moves every end-relative one, so the shift belongs in one place that every
consumer resolves through rather than as a local subtraction at each of them.

**Two things that are not features, which is why neither earlier pass saw them.** Their always-loaded
agent file is 25KB and the reasoning lives in scoped files read on arrival, totalling around 209KB.
This tree had the same content model and the opposite loading strategy: one 153KB file in every
session whatever the question was. Taken, and it is now 10KB with the rest under `docs/internals/`
and beside the package each part describes. And their merge gate runs drift checks on generated
artifacts, which this tree had no equivalent of despite committing three kinds of generated output.
Taken as the `generated` CI job, which found two things immediately: an absolute path in
`contractkit.config.json` that resolved on exactly one machine, and an SDK that had already drifted
from its contracts.

## The fourth pass, which took the third pass's lesson as its method

**2026-08-28**, one day after the third. The third pass ended by saying the other implementation is
most useful as a list of questions to ask of this tree and least useful as a list of things to build.
This pass did only that: take each thing the other station GUARDS, ask the same question here, and
measure the answer. Four questions, and **two of them came back "no fault, and here is the number"**,
which is worth as much as the two that found something and is the reason they are recorded rather
than dropped.

### The one that found something: the model meter is blank exactly where a cap would need it

`script_history.usage` is what any budget would be built over, and it is the surface the first pass
called out as "per attempt and never adds up". Measured on this station, 237 write attempts between
2026-08-21 and 2026-08-26:

| writer | outcome | attempts | no usage recorded | tokens |
| --- | --- | --- | --- | --- |
| model | written | 115 | 0 | 245,068 |
| model | declined | 58 | 36 | 44,040 |
| model | failed | 3 | 3 | 0 |
| deterministic | written | 50 | 50 | 0 |
| deterministic | declined | 11 | 11 | 0 |

**Two of those blanks are correct and one is not.** The 61 deterministic rows made no model call, so
no usage is the honest answer. Of the 58 model declines, 22 were the station refusing what the model
wrote (wrong voice, past the word ceiling, a break about neither record, a spent signature) and every
one of those records its usage properly: the meter works wherever the model answered.

What is left is **13 attempts that provably occupied the model and recorded nothing**: 10 of the 36
"the model writer had nothing to say here" declines carry a non-zero `duration_ms`, and all 3 failures
do, at an average of 7,972 ms for a plugin disposed with the response body still open and 60,007 ms for
one that waited out its budget and gave up. That is 7.4% of the 176 model attempts, and the shape of
it is the finding rather than the size: **a timeout and a mid-flight disposal are the two ways a
runaway costs money, and they are precisely the two the column cannot see.** A cap built on this
today would be least accurate under exactly the conditions that would cause somebody to want one.

The whole-station number that [station-intelligence.md](station-intelligence.md) §2 says it lacks is
**289,108 tokens over 5.3 days, about 54,400 a day**, on a local model with no bill. Recorded there
as well, with what it does and does not change.

### The one with no answer here at all: a notebook that only grows

The other implementation added a decay rule to its accumulated per-character continuity, on the
stated grounds that without one a few early ideas become attractors and dominate every later
programme. `deadair.persona_notes` has no equivalent: `last_used_at` rotates which notes are SHOWN,
which is real mitigation and is not the same mechanism, and the only things that ever remove a note
are an operator rejecting or deleting one.

**Not measured, and honestly so: there are 4 rows in that table today.** The distil pass has barely
run. This is a question to answer before it is a fault to fix, which is the right time to answer it,
and it is written up in [personas.md](personas.md) §6 rather than here.

### Two asked, and answered no

**Artist name-variant folding, which the third pass recorded as "a decision already made here".**
That claim is half right and the other half is worth pinning down, because the mechanism it names does
not exist. `artistKey` folds the collaboration case by taking the lead artist only, and says why.
Nothing folds a leading article: `normalizeKey` strips apostrophes, folds accents and transliterates,
and "The Beatles" and "Beatles" would key differently. Measured on this library: **394 artists, 17
whose key begins "the ", and 0 collisions** that a leading-article fold would merge. Also measured, and
the more useful half: **0 disagreements between `play_history.artist_key` and the catalog's
`artists.artist_key`** for the same aired artist, so the cooldown and the catalog do agree today.

The risk is structural rather than live, and the conditions that would make it live are worth naming
so this is not re-measured for nothing: a second provider writing the same act's credit differently,
or a model-named pick entering through a path that keys off the display credit. Both are `PickResolver`
questions and neither has arrived. **Re-run the two queries above before building anything**, not the
survey.

**Whether a break's forward claims can go stale between writing and air.** The other station has taken
four separate bugs here (a clock link running ahead of air, then behind it, then a wrong meridiem,
then an operator wanting the clock kept out of links entirely). This tree reached the other answer
first: `break.claims.ts` gives a phrasing an expiry and checks it before air, the clock words have to
come back verbatim so that they are checkable at all, and `namesWrongTimeOfDay` and
`contradictsDayPart` close the half that is about the wrong words rather than the wrong time. No
action, recorded so the question is not re-opened.

### Three convergences, and one guard to carry into the beat layer

The other implementation is currently working toward a single arbitrated talk-slot scheduler, after
bugs in which idents aired back-to-back with links and in which one kind of break systematically
starved another. `BreakPlanner.plant` is already that: one place computes the wanted slots, and a
boundary that already holds a break is walked past on the stated grounds that two breaks back to back
is worse than one break a boundary later. Likewise its provider client learned to stop treating an
error response as audio, which `track.audio.service.ts` does by mapping content-type through a
whitelist and refusing an extension it does not recognise; and its listener gate learned not to close
on a single failed poll, which `AudienceWatch` documents as the reason `lastReadAt` is a separate fact
from the heartbeat.

**The guard to carry into rank 2 below**, which is new and is not a convergence. Two of that station's
worst analysis bugs were both in the beat layer and both are the naive implementation rather than bad
luck: a tempo detector run without octave correction reports double-time on slow material *and* scores
the wrong tempo as fully plausible, and a vocal detector run at its default threshold produced enough
false positives to break the cue points that depended on it. [track-analysis.md](track-analysis.md)
already names `beat_confidence` as the load-bearing field a naive build omits, which is the same
insight from the design end. What these add is that **the confidence has to be wrong-tempo-aware
rather than merely present**: a number that expresses "this is definitely 140" when the record is 70
is worse than no number, because the ladder is built to trust it.

**One operational note for the sidecar, same layer.** A long-running Python process that decodes whole
records accumulates resident memory that the allocator does not return, independent of any leak in the
code. Their analysis worker grew unbounded over long uptime for exactly this reason. `analysis/` has
the same shape and has not been watched for it. The cheap answers (trim thresholds, or recycling the
worker every N records) are worth having in hand when the beat layer makes each measurement more
expensive, rather than diagnosed later.

### One thing that is not a finding about either station

An upstream library server is reported to be about to renumber every song id, which would invalidate
every binding in `track_sources` at once. That is not a comparison and it is not deferred design: it
is an external deadline with real code under it, and it has its own file at
[provider-id-stability.md](provider-id-stability.md).

## What is deliberately not wanted

Recording these stops the survey being re-run to reach the same answer.

- **Player skins, native apps, a public player.** This console is a broadcast desk and deliberately
  does not play the mount. The listener surface is the mount itself plus whatever the operator points
  at it.
- **A community catalog of shared personas, skills and shows**, and the three pages around it: a
  directory of other stations broadcasting now, a dispatch blog, and a shelf of third-party players.
  The catalog is a good design (prompt-only by contract, so the reviewed exchange can never carry
  code) and all four are good designs for a project with many installs. This one has one operator.
  What this rejection does NOT cover is the authoring half above: an operator writing a kind of break
  for their own station needs no exchange to share it through.
- **Stem separation for transitions.** The other station does it, opt-in, with a byte-budgeted cache
  that overran its own 500 GB budget to 674 GB before the accounting was fixed. It needs a GPU, a
  second model with its own weights licence, and a large cache, and it pays off only at boundaries
  that already blend. Not worth it here.
- **File-based IPC**, which is the most useful negative finding in the survey. The other station's
  controller and mixer talk entirely through files in a shared directory, and its own notes are a
  catalogue of the tax: atomic writes silently degrading to non-atomic copies on every containerised
  install for want of a temp directory on the same filesystem, one-writer-per-file held by
  convention, configuration files read once so a change needs a mixer restart, and marker files
  existing purely to carry facts the annotation path cannot. HTTP plus a leased mount is the better
  call and this is the evidence for it.

## Worth taking, in order

Revised after the second pass, with the original reasons kept, and marked after the third.

1. ~~**The licensing page**~~, first because it is an afternoon, it is prose rather than engineering,
   and it is the only entry whose timing is set by something outside this repo. **Built 2026-08-27**,
   as [`docs/licensing.md`](../licensing.md), alongside the README and LICENSE it turned out to be
   the front half of: a repository meant to ship for other people to run had no front door at all.
2. **The beat layer**, because it is one measurement pass that settles three deferred entries: the
   ending-shaped fade above, the talk-up limit in [track-analysis.md](track-analysis.md), and the
   vocal-onset half of [track-lyrics.md](track-lyrics.md). Now also carries the trim rules from the
   third pass, which arrive with it whether or not anybody plans for them.
3. ~~**The station check-up**~~, because everything it reads already exists and it is the answer to a
   question the operator asks at three in the morning. **Already built** when this was written and
   the survey did not know it; see the third pass.
4. **Trace correlation**, small, and it is what makes the check-up and the usage surface readable
   rather than merely present. Promoted in practice by 3 landing: there is now a page that assembles
   an answer, and no way to read one decision's calls as a unit underneath it.
5. **Persona chattiness**, one nullable column and one term in a walk, decided about silence first.
6. **Operator-authored break kinds**, which is the largest of the second-pass findings and the only
   one that adds a surface rather than a field.
7. **The embedding axis, and the map with it**, the largest overall and the only one that unblocks a
   file currently marked blocked. Do not start it without the calibration rule above, and do not build
   the map first: it has nothing to draw.
8. The small ones, in any order, none of which is a day's work.

**Added by the fourth pass, and neither is ranked against the list above**, because both are answers
to a deadline rather than choices about what to build next:

- **The renumber guard**, [provider-id-stability.md](provider-id-stability.md) phase 2, which is the
  only item on this page whose timing belongs to somebody else's release. Phase 2 alone is small and
  is correct whether or not the renumber ever happens.
- **Metering the model calls that produce nothing**, which is a defect in instrumentation rather than
  a feature, and which rank 4 (trace correlation) would subsume if it is done first. Do not build the
  budget in §2 on the column as it stands.

**The lesson of the third pass, which is worth more than any entry above.** Two passes over the same
station asked "what does it have that we do not", and the answer both times was a list of features.
The third asked "what does it GUARD that we do not" and the first thing it looked at was a live bug
here, in code that had been reviewed, documented and measured. The other implementation is most
useful as a list of questions to ask of this tree, and least useful as a list of things to build.

**What the fourth pass adds to that**, having used it deliberately: the method's real output is
numbers, and half of them say nothing is wrong. Two of its four questions closed with a measurement
and no work, and those are the entries most likely to save a future pass, because an unanswered
question invites the survey to be run again while an answered one does not. **Record the negative
results, with the queries that produced them.** The failure mode of the third pass's lesson, left
unqualified, is a standing invitation to go looking for bugs and to find things that are not there.
