# What a comparable station does that this one does not

**Written:** 2026-08-22, after reading another self-hosted station of the same shape end to end:
Icecast and Liquidsoap in containers, a Node brain above them, a Subsonic library, a local model, a
local speech engine, a Python analysis sidecar. Close enough to this tree that almost every finding
lands on a seam that already exists here.

**Revised:** 2026-08-22, after a second pass over the same station's published operator manual and
its community pages rather than its source. The counts below describe the first pass and are left as
they were; the second pass is its own section, near the bottom, and it changes the ordering at the
end.

**Status: a survey, and nothing in it is built.** It is written down for the reason
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

Revised after the second pass, with the original reasons kept.

1. **The licensing page**, first because it is an afternoon, it is prose rather than engineering, and
   it is the only entry whose timing is set by something outside this repo.
2. **The beat layer**, because it is one measurement pass that settles three deferred entries: the
   ending-shaped fade above, the talk-up limit in [track-analysis.md](track-analysis.md), and the
   vocal-onset half of [track-lyrics.md](track-lyrics.md).
3. **The station check-up**, because everything it reads already exists and it is the answer to a
   question the operator asks at three in the morning.
4. **Trace correlation**, small, and it is what makes the check-up and the usage surface readable
   rather than merely present.
5. **Persona chattiness**, one nullable column and one term in a walk, decided about silence first.
6. **Operator-authored break kinds**, which is the largest of the second-pass findings and the only
   one that adds a surface rather than a field.
7. **The embedding axis, and the map with it**, the largest overall and the only one that unblocks a
   file currently marked blocked. Do not start it without the calibration rule above, and do not build
   the map first: it has nothing to draw.
8. The small ones, in any order, none of which is a day's work.
