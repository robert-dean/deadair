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

**Fifth pass:** 2026-08-30, and the first one whose main finding is about code written HERE in the
window rather than about anything the other station does. Weather shipped as a capability, and it did
not inherit `break.claims.ts`: a reading is fetched at write time, carries an `observedAt` that
nothing reads, and nothing expires it before air. Also: the other station's continuity-decay reasoning
sharpens [personas.md](personas.md) §6 into choosing a tier rather than a rule, and the non-Latin
speech class it keeps taking bugs on is measured at 0 here for a reason that belongs to the library
and not to the code.

**Seventh pass:** 2026-09-02, the same day as the sixth, and the first to read the other station's
public FAULT list rather than its tree: 325 entries over four months, 281 substantive. Every one was
classified against this tree by reading the code path. Nineteen are live here today, and two of those
are claims made in this directory that the code contradicts, which no amount of reading the other
tree could have found because the docs were what got read.

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

~~**Nothing correlates one decision's calls.**~~ **BUILT 2026-08-28**, as described: ambient id on the
`plugin.invocation.deadline.ts` shape, append-only JSONL, a writer that swallows everything. The
seams were the two named here. Three things the design above did not have:

- **There is no new id.** Both roots already carry a correlation id that is already in the audit
  trail — `JobContext.id` and `ctx.requestId`, both landing on `AuthorizationContext.request`, the
  second written into the `app.request_id` GUC. A second id would have meant two ways to name one
  decision and a join between them, which is what this was supposed to remove.
- **The span belongs around the model DRAIN, not around the plugin call.** `PluginInvoker.invoke`
  bounds getting a generation handle, and the words arrive afterwards through `collectGeneration`.
  Measured on the first live run: one fact-extraction generation reads **7ms** at the invoker and
  **19,243ms** at the drain. Instrumenting only the obvious seam would have under-reported the
  station's largest cost by three orders of magnitude.
- **Always on, not behind a setting.** A span is a couple of hundred bytes where a capture is tens of
  kilobytes, and the failure it explains is the one nobody predicted — which is the case an opt-in
  diagnostic is never on for. `station-intelligence.md` §2 lost eight of its ten cases to exactly
  that. Bounded to seven days of files instead.

`apps/api/scripts/traces.ts` reads them back, because a format nobody has a reader for is a format
nobody reads. First run on this station, over 191 calls: 98s of model time over 26 generations, and
62s in one plugin method (`wikipedia enrichment.enrichArtist`) that no log line had ever attributed.

~~**The one limit worth knowing.**~~ A job that enqueues another job is two decisions and gets two
traces. They still do — separately scheduled, separately retried, possibly minutes apart on
different workers — but **the edge between them is recorded now** (2026-08-28, the commit after).
`Trace.parent` carries the immediate parent, `TracingJobBroker` stamps it into the payload on `send`
because there is no header on a queue row and nothing else travels between two decisions, and both
job bases lift it back off before `execute` ever sees it.

Three things that decided the shape:

- **`schedule` is deliberately not stamped.** A cron row is written once at boot and fires forever,
  so a parent on it would name that boot on every run for as long as it lives. Only `send` links.
- **A broker, not a convention.** Twenty-odd `send` call sites, and a missing edge looks exactly like
  a root — so a link that depended on remembering would be silently wrong wherever somebody forgot.
- **Every job now records a `job.run` span**, which is what makes the edge survive a decision that
  called nothing. It also gives each job a wall-clock and an outcome, which nothing had before.

**And it caught a live bug on the first boot, which is the part worth keeping.** pg-boss delivers a
cron job's absent payload as `null` while the runner types it `Payload | undefined`, so
`'__trace' in null` threw and took `ScheduleTickJob`, `scrobble.flush` and three others down before
`execute` was reached. `== null`, not `=== undefined`: **the signature is not evidence about the
value when the value comes off a queue.** Found by watching the log after deploying rather than by
any test, which is the argument for verifying against the running station.

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

## The fifth pass, where the sharpest question was about this tree's own new code

**2026-08-30**, two days after the fourth, and the method is unchanged: take what the other
implementation guards, ask the same question here, measure the answer. What is different is the
subject. **This tree shipped a capability in the window** — weather, as a plugin, a capability, a
source, a floor writer and a model writer — and the best question this pass had was not about the
other station at all. It was whether a capability built AFTER a guard inherits it.

It did not.

### A new claim, and nothing expires it

The other station has spent four separate bugs on the same lesson: a break is written before it airs,
so anything it asserts about the present has to survive the gap. This tree reached that first and
better. `break.claims.ts` gives a phrasing a window, `BreakPlanner.ripen` rewrites what has drifted,
`toPlayerItems` drops what cannot be rewritten in time, and the two callers share one predicate
precisely so they cannot disagree.

**`brokenClaim` knows two kinds of claim, `item` and `time`, and a weather reading is a third that
nobody added.** The `time` kind is only the clock PHRASING: `claims_time_from` / `claims_time_until`
come from `roughTime`, so what is protected is "it's just after nine" and not "it's raining".

The rest of the weather path is careful, which is what makes the gap easy to miss:

- `WeatherService` **refuses a reading with no `observedAt`** (`weather.service.ts:131`), so the age
  of the observation is known to be present.
- It is carried into `SpokenWeather` (`weather.words.ts:32`), and handed to the model's own tool
  (`weather.tool.ts:178`).
- `inventedFigure` in `model.weather.break.writer.ts` refuses any digit the reading did not contain,
  on the excellent argument that a forecast's claims ARE its numbers and the true set is known
  exactly.

So the numbers cannot be fabricated. **They can only be out of date**, and `inventedFigure` validates
against the reading the script was written from rather than against the weather at air, which is the
one comparison it cannot make.

**The window, measured.** `WRITE_AHEAD` is 8 items (`break.planner.ts:79`), and that file states that
at the default quarter-hour break interval the window holds two or three breaks. A weather break is
therefore written up to eight records ahead of its slot, and the staleness at air is that plus the
provider's own observation age, which for a national service can be most of an hour before this tree
ever sees it.

**The evidence that this is an omission rather than a decision is one line above it.**
`write.break.job.ts` reasons about air time everywhere: the clock at 234, the greeting at 238, the
daypart at 242, and `bulletin.storiesFor(segment.kind, context, segment.airsAt ?? Date.now())` at
273, where the news source is told when the break will air. Line 278 is
`weather.readingFor(segment.kind, context)`. It is the only call in that file that does not know.

**And the pattern is already in the tree, one module over.** `rundown.ts` holds an `observedAt` on
the playhead and decays the reading by its own age on every read:
`remainingMs - (Date.now() - observedAt)`. That is exactly the arithmetic the weather path has the
inputs for and does not do.

This is the same SHAPE as the era bug the third pass found: the data was present, the column was
right, and the question was never asked of it. A capability that arrives after a guard does not
inherit it, and nothing in the tree fails when it doesn't.

### Two convergences that sharpen a section written two days ago

The other implementation closed its continuity-decay issue in this window, and its reasoning is worth
more than its fix, which is not in the issue. Two sentences from it:

**"Negative prompting is not a forget mechanism."** An "already said, do not repeat" block makes a
topic MORE salient rather than less. This tree reached the same conclusion independently and answered
it better: `break.prompt.ts` bans a spent signature and in the same breath invites a replacement,
because "told only what it may not say, a model reaches for the nearest other thing the sheet gave
it" — and `characterFault` refuses a script that ignores the ban, so the ban is enforced rather than
merely requested. No action.

**"The recency store has no scoping boundary that matches the product's actual boundaries."** Their
proposed direction is three tiers: soft decay, boundary reset, and an operator's hard purge. That
framing is the useful part, and read against this tree it says something [personas.md](personas.md)
§6 did not, because §6 was written two days ago with three candidate rules that were all decay:

- **The boundary tier is already built here, and is correct.** `BreakWriteRequest.recent` is the
  BROADCAST's memory and is kind-agnostic, on the argument that a listener who tuned in twenty minutes
  ago has heard this show and none of the one before it. A station that has just gone on air inherits
  no ban from a programme nobody heard.
- **The notebook must NOT get that tier**, and saying so is the point. `persona_notes` exists to
  outlive a broadcast: a character that accumulates is the feature. Boundary reset would delete the
  thing the store is for. So the notebook wants soft decay specifically, and §6 is now explicit about
  which tier it is choosing and why the neighbouring one is wrong for it.

### A guard that is absent rather than unnecessary, measured at 0

The other station has taken at least five bugs on reading non-Latin text aloud: a phonemizer routing
every language through one engine, kanji read as character descriptions, a language code that needed a
region, and mixed-script track names. It has now moved to native phonemizers per script.

**Measured on this library: 0 of 766 tracks carry CJK, Cyrillic, Hebrew or Arabic in a title or a
credit.** 15 carry extended-Latin accents and they are almost all decorative metal umlauts (`Mötley
Crüe`, `Blue Öyster Cult`), which is a pronunciation question and not a phonemizer one, and
`deadair.pronunciations` is already the seam for it.

So none of that class is live here, **and the reason is the library rather than the code**. That is
exposure deferred, not exposure avoided, and it is worth recording in that form because this tree is
meant to ship for other people to run: the first operator with a Japanese or Russian library meets all
five at once, on a speech path that has never been asked to read a non-Latin character. Not worth
building against today. Worth knowing that the 0 is a fact about this operator's records.

### Nothing in the window is a feature gap

Two releases in the window. What is in them is the settings surface, native lock-screen presence,
first-class station credentials, a max-listeners setting, on-demand jingles, and front-padding a
listener request's intro. Of those, the listener-facing half is already recorded below as deliberately
not wanted, on-demand jingles are `deadair.pads` reached from another direction, and a max-listeners
cap is the only one that is both absent and arguably wanted here, now that the mount is public. It is a
small one and is noted with the others.

## The sixth pass, which asked one question and got a whole design back

**2026-09-02**, and the method is narrower than the previous five: rather than reading the other
implementation end to end again, take ONE deferred file this tree is about to build and ask whether
the other station has already built it. The file was [track-lyrics.md](track-lyrics.md). It had.

**The finding is that the phase that file is worth building for asks the wrong question.** This tree's
design wanted one number from a synced lyric, the first timestamp, as a vocal onset for the talk-up
limit. The working implementation derives vocal RANGES across the whole track instead: a line runs
until the next one, capped so a long gap reads as an instrumental break rather than sustained singing;
lines closer together than a merge gap join; the last line takes a nominal tail. The first range's
start is the onset this tree wanted. **The end of the last range is the point the singing stops, and
nothing else in this tree can answer it.** That second marker is free, it is the other half of a
talk-up, and this tree's design had it as a footnote.

Three smaller things came with it, each of which would have been paid for here in a bug:

- **A tri-state, not a number.** Instrumental, or ranges, or "cannot say". The third case is a track
  with unsynced plain text, which has lyrics and no timings and is neither an answer nor an
  instrumental. Folded into a `min()` it reads as zero.
- **An instrumental sometimes arrives as a lyric line.** LRC carries a metadata tag some tooling
  surfaces as a line, and a lone "Instrumental" placeholder body is common. The test has to be
  anchored to the whole line or a song that sings the word gets classified as having none.
- **The library call this tree's design named is the one that destroys the data.** The plain lyrics
  call flattens structured lyrics to text and drops the per-line timings. There is a by-song-id call
  that preserves them; a track can carry several structured entries so the synced one has to be
  chosen rather than the first; and each entry's global offset has a counter-intuitive sign, where
  positive means the lyrics appear sooner.

**One thing was deliberately NOT taken, and the disagreement is the useful part.** The other
implementation uses the lyric to REPLACE its vocal detector rather than to narrow it, on a measured
argument: source separation never separates cleanly, an instrumental's vocal stem carries enough bleed
that a self-relative energy gate reads it as singing, and that produced a false positive across a
library. A typed timestamp beats that. But this tree measured its own inputs on the same day and got a
different answer: across 52 synced lyrics for records this station actually holds, 12 first lines land
under three seconds and 6 under one. Their conclusion is right about their inputs and ours is right
about ours. **Both passes were measurements against a real catalogue and they disagree, which is the
argument for measuring rather than for either answer.**

### The convergence that names both markers

Neither station invented this. Broadcast automation has stored the vocal-start cue as an editable
per-track marker for decades, beside outro, fade-out and start-next markers, and at least one system
places its talk markers in PAIRS and will not accept one alone. That is the same conclusion the sixth
pass reached from the other direction, and it carries a third consequence neither station's code shows:
**the pair is expected to be operator-editable.** The other station has already paid for the guard
that needs, on a different column entirely: every walk revisits every track, so an override an
automatic writer can clobber is one the next pass silently undoes, and the refusal belongs in the
writer's own WHERE clause. This tree has the same lesson one subsystem over, in the schedule's manual
takeover, and nowhere in the catalog.

### One use of a lyric this tree had not listed at all

The other implementation puts a capped lyric excerpt into the text it embeds for similarity, beside
tags, measured acoustics and an era word. Its stated reason is better than the feature: with every
optional line empty the vector IS the label, so similarity ranks by artist and album wording, a
prolific artist self-clusters, and two unrelated artists whose names share a word land beside each
other while the caller believes it is reading mood. That is a sharper statement of the embedding-axis
trap the fourth pass recorded, and it names a cheap input that breaks the degeneracy. Recorded in
[track-lyrics.md](track-lyrics.md)'s uses table, unscoped, for whoever builds that axis.

## The seventh pass, which read the fault list instead of the tree

**2026-09-02**, the same day as the sixth. Six passes read what the other station BUILT: its source,
its manual, its releases, one deferred file at a time. This one read what it BROKE: the public fault
list, 325 entries over four months. Dropping dependency bumps, catalogue submissions, native-app
availability and diagnostics dumps leaves 281, and each of those was put to this tree as a question
and answered from the code rather than from the docs in this directory, because the fourth pass
showed the docs can be wrong.

The counts govern how to read it. **Nineteen faults are live here today.** About 150 are guarded,
most of them by a decision this directory already records the reasoning for; about 50 are deferred
design in this directory; the rest belong to a listener product and do not apply. Nineteen after six
passes is the measure of the method: reading a tree finds what it has, and reading its fault list
finds what breaks in a station of this SHAPE, which is a different set. The previous passes caught
four of the nineteen in passing (the sidecar's memory, the artist seam, the talk-over stamp, the
planted tail). The other fifteen are new.

### Two claims in this directory that the code contradicts

These come first because they are the class the fourth pass argued is worth most, and because both
are small.

**A record on a playlist put on air passes no gate at all.** [programming.md](../internals/programming.md)
says a dislike is an instruction no lineup may turn off. The console's put-on-air path goes
`putOnAir` → `sourceTracks` → `toRundownTracks` → `replaceFrom` (`director.service.ts:1181`) and
`PickResolver` is nowhere on it: no `rejectDisliked`, no era, no advisory policy, no cooldown. A
record the operator disliked last week airs the moment it sits on a playlist they put on air, and a
`clean-only` station plays an explicit copy if the playlist holds one. The setlist argument, that
somebody sequenced it, covers the rotation RULES and was never meant to cover the veto. Beside it,
`toRundownTracks` (`director.console.service.ts:507-529`) does not fold by `songKey`, so two rips
of one song on a playlist both air, possibly adjacent. The fix keeps the sequence: run
`sourceTracks` through `resolver.resolve` with `NO_RULES`-shaped rules so the veto, the advisory
and the period apply and nothing else does, and fold by `songKey` keeping the first.

**The station guesses its voice, and the console says it refuses to.** The "Speak with" descriptor
(`settings.registry.ts:790-796`) is free text whose help says the station "declines to guess rather
than airing the wrong voice", and [dj-voice.md](dj-voice.md)'s "What shipped" says the same.
`selectPlugin` (`plugin.selection.ts:93-98`) returns the first candidate when the key is unset, and
`speech.service.ts:107-109` sorts candidates by plugin id, so with both engines installed the remote
one wins on the letter c. **Measured on this station: 56 renders between 2026-08-23 and 2026-09-01
bounced `rendering → written`** on the remote engine's restart or its HTTP 500, while the local
engine sat enabled, reachable and never asked. `render.segment.job.ts:147` releases the segment
correctly on `unavailable`, and nothing asks anyone else, so each was a break skipped at air.
Installing a second plugin silently moved the station's voice onto a remote GPU box and turned every
one of its outages into silence. There is deliberately no fallback engine (`speech.settings.ts:3-7`),
and that design holds; what is wrong is that an unset key PICKS rather than refuses, against its own
copy. The fix is a `select` fed from `speakers()`, which the voices page already reads, and an unset
key with two candidates refusing as promised.

### The other seventeen, by where they sit

**Programming.** Artist spacing stops at the batch seam. `spaceArtists` reorders one batch
(`rotation.rules.ts:379`, called at `pick.resolver.ts:255`), `append` (`station.lineup.ts:804`)
pushes it onto the tail without looking at what the tail ends with, the cooldown reads `play_history`
only (`play.history.repository.ts:133`), and `extend.lineup.job.ts:112` deliberately threads
`avoidSongKeys` and not artists. With `EXTEND_BELOW` at 8 the order holds about eight unplayed records
when a refill is planned, and an artist in that planned tail is invisible to the next batch. Batch N
ending `[…, X, Y, X]` and batch N+1 opening `[X, Z, X]` is four by one act in six slots, every
individual step legal, across a seam a planted break makes no less adjacent to a listener. The wiring
exists and nothing uses it: `SetInputs.avoidArtistKeys` is read by the catalog generator and set by
nobody, and `judge` does not read it. Pass the last `maxPerArtist + 1` planned artists as
`avoidArtistKeys`, union them into `judge`'s history read, and seed `spaceArtists` with the order's
current last item. That is a short list, so the starvation argument in `programming.md` does not
reach it.

Also: a playlist-anchored block plays through once and drifts into ordinary rotation without saying
so. `mode` and `onEnd` are on the slot, copied at changeover, and honoured by `finish`; the console
still cannot set either, which [repeat-overrules.md](repeat-overrules.md) recorded on 2026-08-19 and
is still true; and `topUpIfShort` refills at eight remaining on every pass, so `'repeat'` can never
fire on a rotation even if it were set. Phase 3 of that file, plus one guard in the refill.

**Breaks and productions.** A production with no source material is told the content "is yours to
invent. Keep it to what you actually know" (`production.prompt.ts:278`), the beat rules forbid an
invented place, date, price or quote, and nothing forbids a real-sounding discography credit for a
record the station was never given. No fact substrate reaches a production, and the break prompt's
"no connection to any other record" line (`break.prompt.ts:848`) has no counterpart in the beat
prompt. This is the other station's fabricated-feature bug in the one writer here that still has the
soft instruction. Second, the broadcast-clean rule is passed as `cleanLanguage` by all five break
writers and by no beat, so a crude persona sheet is reined in on breaks and not on a phone-in it
presents. Third, `brokenClaim` knows `item`, `time` and `reading` and has no PREVIOUS-side claim,
so an operator moving a record to sit between the just-finished record and an already-written break
leaves "that was X" airing after Z. All three are a field and a sentence each.

**The model.** `reasoningEffort` is sent on every station call and nothing can turn it off. The
capability's contract (`packages/plugin-sdk/src/capabilities/llm.ts:57-62`) says the field is sent
only when the caller asked, on the stated grounds that a strict server answers 400 to it; the plugin
forwards it whenever present; every one of sixteen call sites hard-codes `'low'`, and the manifest
has no field to suppress it. Point the plugin at a strict server or at a non-reasoning cloud model
and every writer, the set generator, fact extraction and productions fail on the first request; the
floor covers all of it, so the station keeps talking deterministically and the only trace is one
plugin-log line. A plugin config field defaulting to off, which strips the key. Second, `streamText`
(`llm.plugin.ts:238`) passes no `maxRetries` and the installed SDK defaults to two, on top of the
host's own server-sanctioned retry on a 429 or 503 carrying `Retry-After`. A throttling or failing
provider sees up to six POSTs per generation, per tool step, inside one gate admission and one
120-second budget, and a local model that fails after chewing on a prompt runs it three times on the
one GPU slot. None of it is logged; only the terminal error surfaces. `maxRetries: 0`; the registry's
floor is the fallback.

**Playout.** A talk-over is stamped at hand-over and never observed at air. The mixer knows whether a
cue fired or missed (`radio.liq:1117-1137`) and reports it on every reading; `liquidsoap.control.ts:532`
parses it into `QueueStatus.voice` and nothing reads it. Worse than an early timestamp:
`toPlayerItems` holds a talk-over as `handed` before its own record, `markAiring` turns every earlier
`handed` item into `skipped` and counts it (`station.lineup.ts:613-621`), and `remember` writes an
`order.caughtUp` warning that one item never aired (`director.service.ts:2642-2650`). A talk-over
that fired perfectly is recorded as skipped with a warning, and a genuinely missed cue is
indistinguishable from it. Four `order.caughtUp` events since 2026-08-21 on this station, none
attributed; no test asserts a talk-over's state after its record airs. Consume `reading.voice` in
`Rundown.reconcile`, and have `markAiring` pass over items with `over` set.

**The sidecar.** Three, and the first corrects a number in its own README. `analysis/README.md` and
`app.py:59-65` size the worker ceiling on a five-minute track being about 115 MB resident. Measured
here with the tree's own functions on a five-minute stereo signal, the 106 MB decoded buffer held:
`to_mono` peaks 191 MB above it, the cue points 359 MB, integrated loudness 253 MB, true peak 116 MB.
**One decode peaks between 500 and 750 MB**, the default ceiling of four is a few GB, and a file at
the accepted 1800-second maximum is several GB on its own. The cost is `loudness.py:133`, where
`np.square` over a 75%-overlapping strided view materialises it dense in float64, four copies of
every frame. A cumulative sum of squares is exact and linear. Second, the memory-growth shape the
fourth pass named is present and unmitigated: a thread pool in a glibc image, one arena per thread,
no `MALLOC_ARENA_MAX`, no trim, no recycling, and the `rssMb` reading the sidecar already computes is
read only by the connection test. Two lines. Third, and the one that crash-loops: the two image
definitions have diverged on the beat layer. `analysis/Dockerfile:38` installs the beat tracker with
`--no-deps`; the production `Dockerfile:338-341` installs `requirements.txt` and never installs it.
The root Dockerfile's own comment says the analysis block is the one that gets forgotten, and the log
shows it forgotten twice already. The day `beats.py` lands, the dev container imports and the
production sidecar dies at start, which the console shows as "engine off". Beside it, no CI job runs
the sidecar's five test files or starts the built image before pushing it; the `generated` job was
added for exactly this class of drift on the TypeScript side and the Python side got nothing.

**Enrichment.** A provider's config change never reaches what is already stored. Last.fm's tag
switches are applied at map time, the stripped payload is saved under a 90-day TTL
(`enrichment.service.ts:41`), the walk asks only a provider with no unexpired row, and saving the
plugin config re-initialises the plugin and nothing else. Turn tags on and the library stays tagless
for up to three months; the only escape is one record at a time. A bulk clear by provider, or a
config fingerprint beside the payload. Second, a Subsonic server's `[Unknown Artist]` placeholder
passes `navidrome.mapping.ts:62-67` and the resolver refuses only an EMPTY credit, so every untagged
file becomes a record by an act literally named that, handed to the writer and to MusicBrainz.
Measured 0 here; the first operator with a ripped-but-untagged folder gets it on air.

**Operations.** `/nowplaying` reads the station name once at boot (`nowplaying.module.ts:26-36`,
whose comment admits it) while the writers and the ICY title read it live, so a hardware display
says the old name until a restart. No `unhandledRejection` handler exists anywhere, Node 26
terminates on one, there are 61 fire-and-forget sites, and s6 restarts the process anonymously: the
lease lapses, the mount goes quiet, and nothing in the log says why. Crash-and-restart may be the
right policy; the missing half is the line naming the cause. `POST /personas/import` inherits the
kit's 1 MB body default against nginx's 64 MB. And the schedule board's block drag is the component
library's HTML5 drag, so it is mouse-only on a tablet; the keyboard path through the slot editor is
fine, and the fix is the library's.

### Measured and NOT live, which is worth as much

- **Banter echoing its own "already said" block.** The prompt quotes the last six scripts and the
  guard only reads them for spent signatures; nothing compares an answer against them. Measured: 76
  written model talk breaks, 70 with a prior script in the same broadcast, longest common run against
  any of the previous six is 31 characters, zero verbatim. The ban-plus-invitation design holds.
- **Reasoning reaching the speech engine.** 0 of 330 scripts are instruction-shaped;
  `speakable.script.ts:80` strips a think block and `spokenAnswer` refuses to promote the reasoning
  channel on a length or tool-call stop. Residual: a `stop` turn with empty text still promotes it.
- **The cron missing the repeated autumn hour.** pg-boss matches by previous occurrence within a
  minute, timezone-aware; simulated every pattern in `job.mappings` across London and New York in both
  directions, all fired. Moot besides: the broker passes no `tz`, so the clock is UTC.
- **`rotation.breaks` off leaving the planted tail to air.** Found here as a fault from the playout
  side; already recorded in [break-removal.md](break-removal.md) "Also worth settling" as phase 2 of
  the quiet spell. Two readings reaching it independently is the argument that phase 2 is real.
- **Non-Latin speech.** Nothing new beyond the fifth pass, except that the local engine is sent no
  language code at all, so a CJK run reaches it intact and unrouted, as it did there.

### Absent, and worth a line each

- **A script language.** Nothing carries one: `stream.language` goes only to Icecast, the speech
  capability has no language field, and a French host is a sheet workaround. The fifth pass covered
  the non-Latin SPEECH half; this is the prompt half, and the first thing a non-English self-hoster
  hits.
- **A maximum record length.** Nothing bounds duration; the 64 MB fetch cap passes an hour-long mix
  at 128 kbps. One setting applied in the draw's SQL and in `judge`, so both agree.
- **Library selection.** The sync walks every readable playlist and the library server always
  appends "Everything", so the whole server is ingested unconditionally; an audiobook shelf cannot be
  excluded even by playlist choice. A multiselect over the server's folders.
- **A listener cap as a setting.** The fifth pass said it was the only thing both absent and
  arguably wanted and it never reached [small-wins.md](small-wins.md). It has now.
- **A robot on the MOUNT holding an audience-gated station on air.** The agent refusal exists for
  HLS only; the mount is out of the app's path by design. One nginx `map` on the user agent fed from
  the same setting.
- **Three documentation lines**: that the model host's context length must be set (a default local
  server silently drops the front of a prompt carrying seven tools and a sheet, which is the system
  prompt); that every image is also tagged by commit and that is the rollback; that `docker compose`
  is the v2 plugin.
- **Knobs that are constants**: the per-writer time budget (120 s, 180 s, 600 s in three files), the
  break writers' output ceiling, the listener burst, a SearXNG engine list. Fine for this operator;
  opaque to the next.
- **A re-measure-many.** One record can be forgotten; a schema bump re-queues everything; nothing in
  between, though `analyzer_plugin_id` is stored for exactly that.
- **Pinning the second engine's sentence chunking.** Guarded today by a server default this tree
  does not send; the longest segment here is fourteen times the chunk. One field.
- **Units in `saySymbols`.** `°`, `km/h` and `mph` reach the engine as written, and the weather tool
  hands the model exactly those. 0 aired scripts carry them; structural.

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
   third pass, which arrive with it whether or not anybody plans for them. **It needs no file of its
   own** — `track-analysis.md` is the design, down to the field table — and as of 2026-08-28 that
   file also carries this survey's two guards and the sidecar memory note. Read it, not this line.
   **Re-ranked by the sixth pass**: the lyric half is no longer waiting on the beat layer at all. It
   is cheaper than was thought (98% of a sampled 60 records answered, 87% of them with timings), it
   answers a marker the beat layer does not attempt (where the singing STOPS), and its design is now
   written against working code rather than against reasoning. It can land first and narrow the beat
   layer later, which is the reverse of the dependency this entry assumed.
3. ~~**The station check-up**~~, because everything it reads already exists and it is the answer to a
   question the operator asks at three in the morning. **Already built** when this was written and
   the survey did not know it; see the third pass.
4. ~~**Trace correlation**~~, small, and it is what makes the check-up and the usage surface readable
   rather than merely present. Promoted in practice by 3 landing: there is now a page that assembles
   an answer, and no way to read one decision's calls as a unit underneath it. **Built 2026-08-28**,
   in four commits — the id on every log line, spans at the call boundary, the parent edge between
   two decisions, and a console surface — and it was small as predicted. What it was NOT is what the
   estimate got wrong: the useful seam was the model drain rather than the plugin call around it, and
   the difference between them is 7ms against 19,243ms.

   The surface landed **as a third tab on Check-up rather than a page of its own**, which is where
   the ranking's own words pointed: three tabs are one question in three tenses — what the machinery
   is doing now, what it did, and what that cost — and an operator who finds a stalled loop on the
   first or a warning on the second arrives at the third asking which decision it belonged to. It is
   the one surface in that shell gated on `platform.manage` rather than `platform.view`, on
   `activity.ck`'s own argument read the other way: a span's `error` is whatever a plugin threw,
   verbatim, and a careless plugin can put a token in a message.
5. ~~**Persona chattiness**~~, one nullable column and one term in a walk, decided about silence
   first. **Built 2026-08-28**, and it really was one column and one term — five rungs scaling
   `rules.breakEveryMinutes` in `BreakPlanner`'s station-floor walk and nothing else. The silence
   question was settled the way this entry argued: the quietest rung is half as often and never none,
   because `rotation.breaks` is already that switch. Two things worth carrying:

   - **It scales the station's own floor and not the format clock**, which is the same asymmetry
     `storytelling` has against a `story` band. A band is an operator asking in as many words and a
     habit does not overrule an instruction. There is a test on exactly that, because it is the half
     that would be silently wrong.
   - **It made a sentence on the console false**, which is the thing worth knowing about adding a
     rung to a group of them. The persona editor's section blurb said each dial "only ever asks for
     LESS than the station's own setting"; `chattiness` asks for more at two rungs, and `latitude`
     already did at both of its, so the claim had been three-quarters true before this and fully
     false after. Corrected to what was actually load-bearing in it — that none of them loosens a
     refusal. **Check the shared blurb when adding a field to a group, not just the field's own
     description.**
6. **Operator-authored break kinds**, which is the largest of the second-pass findings and the only
   one that adds a surface rather than a field. **Promoted to its own file 2026-08-28:**
   [operator-break-kinds.md](operator-break-kinds.md), which costs the five places a kind currently
   touches and names the three things to decide first — chiefly whether an authored kind runs code,
   because a kind that fetches is a plugin wearing a different name.
7. **The embedding axis, and the map with it**, the largest overall and the only one that unblocks a
   file currently marked blocked. Do not start it without the calibration rule above, and do not build
   the map first: it has nothing to draw. **Promoted to its own file 2026-08-28:**
   [embedding-axis.md](embedding-axis.md), carrying the calibration trap, the two second-order rules,
   and the costs counted before anybody starts.
8. The small ones, in any order, none of which is a day's work. **Promoted 2026-08-28:**
   [small-wins.md](small-wins.md) — and writing them down corrected one: the MCP surface is small in
   mechanism and not small in authorization, so it waits on
   [service-actors.md](service-actors.md) rather than sitting beside the other two.

**Added by the fifth pass, and it goes at the top rather than into the list**, because it is a defect
in shipped code and everything above it is a feature:

0. ~~**Give a weather reading an expiry**~~, which is the smallest correct version of what the fifth
   pass found. **Built 2026-08-30**, in the three sizes and the order this entry gave them, and the
   estimate held: the inputs really were all in hand and the first size really was worth having
   alone. `readingFor` takes `airs_at` — the same argument `storiesFor` was already handed one line
   above it — and `rotation.weatherMaxAgeMinutes` bounds the age at two hours by default, wide on
   purpose because a national service can be most of an hour behind before this station sees a
   reading. `segments.claims_reading_until` is the third `BrokenClaim` kind, rewritten by `ripen` and
   dropped by `toPlayerItems` through the one predicate.

   Three things the design above did not have:

   - **The third claim is shaped unlike the second, and the difference is what makes it safe.** One
     end rather than two and no direction, because an observation has no not-true-yet — which is
     also exactly why it IS worth a rewrite where an early time claim is not: the rewrite fetches a
     new observation instead of re-deriving the same phrasing from the same unchanged `airs_at`. And
     size 1 is what stops the loop when the service has NOT moved on, because the reading is then
     declined, the segment fails, and `reopenSegments` does not reach a failed row. **The ordering
     this entry gave was load-bearing rather than merely sensible.**
   - **Both weather writers stamp it UNCONDITIONALLY**, where `claimsNext` and `claimsTime` are
     answered rather than assumed. Those are conditional because a phrasing may have dropped the
     record or the time; there is no weather break that dropped the weather, since every phrasing
     carries the reading outside its optional parts and `WEATHER_SHAPE` exists to make the model
     state it.
   - **The third size came out as a type rather than as a rule**, which is the part worth keeping.
     `SUBSTRATE_FRESHNESS` maps every field of `BreakWriteRequest` to what keeps it true until air,
     so a new field fails `tsc` until somebody answers — `boundary.json.safe.ts`'s shape, for
     `boundary.json.safe.ts`'s reason. The vocabulary's most useful value is `perishable`, which
     admits there is no guard: a list offering only guards pushes somebody toward the nearest one
     that almost fits, and a table naming a guard that does not run is worse than no table.
     `StationTool.freshness` asks the same question of the tool loop, which the table cannot see.

   **And the audit's most useful result was a negative one, which the method predicted.** Every break
   writer passes `tools: false`, so `get_weather`, `read_news` and `search_web` reach a model only on
   the set-generator and persona paths and no tool answer is currently spoken on air as a statement
   about the present. That is exposure DEFERRED, not avoided — the day one of those five writers
   turns tools on, three `perishable` declarations become three claims going to air with no expiry,
   and the required field is what asks.

**Added by the fourth pass, and neither is ranked against the list above**, because both are answers
to a deadline rather than choices about what to build next:

- ~~**The renumber guard**~~, [provider-id-stability.md](provider-id-stability.md) phase 2, which is
  the only item on this page whose timing belongs to somebody else's release. **Built 2026-08-28.**
  The prediction that it is correct whether or not the renumber happens turned out to understate it:
  building it found a walk truncated at the page cap reaching the sweep looking complete, which is the
  same catastrophe from a cause that needed no upstream release and was live in the tree.
- **Metering the model calls that produce nothing**, which is a defect in instrumentation rather than
  a feature, and which rank 4 (trace correlation) would subsume if it is done first. Do not build the
  budget in §2 on the column as it stands. **Widened and then half-closed, 2026-08-28**: the same
  blindness was on the SET side and was worse there, because the finish reason was overloaded rather
  than merely absent — `LlmService` reported `length` for a real ceiling hit AND for both preemption
  paths. **That half is fixed**: the conversation's reason is now the host's own vocabulary with
  `'preempted'` in it, so eight log sites and the capture became correct without being touched. The
  `script_history.usage` half is untouched and is still what rank 4 subsumes. See
  [station-intelligence.md](station-intelligence.md) §2 for both, and for the rule they share: record
  the cost and the cause at the call boundary, not from the answer.

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

**What the fifth pass adds, and it is the last thing this file needs to say about method.** Its best
finding was not about the other station. It was about a capability this tree shipped two days earlier,
and the question that found it — "does the new thing inherit the old guard?" — did not need a
comparable station at all. The other implementation supplied only the prompt: it has spent four bugs
on breaks whose words outlive their truth, which is what made "what else asserts something about the
present?" the obvious question to ask here.

So the honest ranking of what this file is for has moved. The survey was worth doing once. **What is
worth repeating is not reading somebody else's tree, it is keeping their list of hard-won questions
and running it against ours whenever this one grows a new surface.** A guard is a claim about code
that existed when it was written, and nothing in a test suite notices when a new caller quietly opts
out of one.

**And what building rank 0 added to THAT**, which is the last word this file has on method: the best
outcome of a hard-won question is not an answer, it is a type that asks it again for free. The fifth
pass's finding was that nothing failed when weather skipped `break.claims.ts`, and the fix for the
weather path is a column while the fix for the FINDING is `SUBSTRATE_FRESHNESS`. A pass like this one
can only be run when somebody thinks to run it; a mapped type over the substrate runs on every build,
against every field anybody adds, forever. **Where a question can be moved into the compiler, that is
where the answer to it belongs.**

**Seventh-pass additions to the order**, 2026-09-02, and where they sit relative to the numbers above:

- **Before anything else, the two false claims**: the put-on-air gate and the voice selector. Both
  are wrong TODAY on a running station, both are under a day, and the second is measured at 56 silent
  breaks in nine days.
- **Before rank 2 starts**: the sidecar's three, because the beat layer makes every decode dearer and
  adds the very import that the diverged image forgets. The memory fix is one function, the arena cap
  is two lines, and a `pytest` job plus a `/health` smoke on the built image is what `generated` is on
  the other side.
- **With the next director change**: the artist seam and the talk-over reading, which are the two
  that a listener hears.
- **Everything else in the seventh pass is a field or a sentence**, and none of it needs a file.
