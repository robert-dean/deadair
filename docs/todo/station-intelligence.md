# Deferred: the station's judgement

**Designed:** 2026-08-09, from a capability review of the tree against what a finished station does.
**Revised:** 2026-08-10, section 3 only, after a survey of what track metadata can actually be
bought. Nothing sells an ending; the revision is a better measurement, not a source.
**Status:** deferred, not disputed. Every entry names the seam it drops into and what is already
built underneath it.

The station can programme itself, air a running order, plant its own breaks, speak in its own voice
and talk over a record. What it cannot do is have an opinion. Everything it chooses, it chooses by
rule: a weighted draw, a repeat window, an artist cooldown, an ident every fourth record. That is
the right floor and it should stay bound as the floor. This file is the layer above it.

Nothing here is a prerequisite for anything else here, with two exceptions that are called out where
they apply. Each entry is independently shippable.

## What exists, so nothing below has to re-derive it

Read this before designing against it. All of it is built.

- **`SetGenerator.generate` takes and returns NAMED picks** (title + artist strings, optional
  canonical id). That shape is the whole point: it is what a language model can produce, so a second
  generator is a second binding of the token rather than a reshape of everything downstream.
  `CatalogSetGenerator` is the deterministic binding, and it knows the catalog id so its own
  resolution is exact.
- **The rotation rules are pure and table-tested** (`rotation.rules.ts`): repeat window, artist
  cooldown, per-artist cap, artist spacing, and `rejectDisliked`, which is an instruction rather than
  advice and cannot be turned off by a lineup. Dislikes already exist at track, record and artist
  level.
- **`deadair.segments` is one airable element that is not a record**, with `kind` as free text and a
  `planned | rendering | ready | failed` state. **A segment that is not `ready` is skipped, never
  waited for.** That rule is what lets everything below fail without costing the station silence.
- **The station has a voice** (`speech` capability, `plugins/kokoro`, `render.speechPluginId`) and
  can talk OVER a record, timed inside `radio.liq` against the music itself rather than against the
  app's clock.
- **Playout is a lease with two conditions** (a programme, and an audience), so anything below that
  wants to drive the station has to renew it or be silently muted.
- **`host.fetch` is the only egress a plugin gets**, with per-upstream allowlists, shared rate-limit
  buckets and an invocation-scoped budget. Anything below that talks to a third party should be a
  plugin for that reason alone.

Two things that are true and easy to assume otherwise. `radio.liq` does **no crossfading**: items
butt up against each other, and the only level shaping is `normalize(target=-16.)` on each leaf
source plus the duck ramp. And nothing measures audio: `duration_ms` is nominal where it exists at
all, and `bpm` on a catalog row is whatever a provider declared, not something we heard.

---

## 1. An LLM DJ bound to `SetGenerator`

**Built 2026-08-12.** `ModelSetGenerator` sits in front of `CatalogSetGenerator` in a
`SetGeneratorChain`, behind `llm.setGenerator`, off by default. The four failures below were each
built for and the notes on them stand. Three things came out differently from this section, and the
first is the one worth reading before anything else lands near selection.

**"Nothing else moves" was wrong, and it was wrong in the direction that matters.** The rotation
rules lived inside `CatalogSetGenerator` — `rejectDisliked`, `filterByHistory`, `capPerArtist`,
`spaceArtists`, all of them — which was correct exactly as long as that was the only generator. A
pick is a NAME, so a second binding hands over titles nothing has judged, and `PickResolver` was
resolving them straight into the running order. A dislike is an INSTRUCTION that no lineup may turn
off, so this was a correctness hole rather than a matter of taste: a model naming a disliked artist
would have aired them. §5's "enforcement is inherited, never added" turns out to be a
**prerequisite** of this entry rather than a sibling of it. The rules now run in `PickResolver`,
which is the one step every pick from every source passes through; the generator still filters
before its own draw, and both places say why neither is safe to delete.

**The chain TOPS UP rather than falling through**, which is the one place it could not copy
`BreakWriterRegistry`. A break is one sentence and is all-or-nothing, so that registry takes the
first answer and stops. A set is `count` picks, and a model that named six of fifteen has not failed
— it has done most of the job. Falling through would throw away the good half of the answer, so each
binding is asked for what is still missing and the floor finishes the rest. Songs already chosen
thread down as keys to avoid; artists deliberately do not, because excluding every artist already
queued starves a long rotation of its own library.

**The discovery tool had to be a new one.** `CatalogSearchTool` searches provider PLUGINS, which is
right for a break writer checking a claim and wrong for a DJ: a pick survives only if it matches
`deadair.tracks` with a live binding, so a model steered by provider search names records the station
never ingested and the running order comes up short for reasons nothing in the log connects to the
search. `LibrarySearchTool` answers from the catalog instead. Bans narrow it and rotation rules
deliberately do not, per the note below.

**It is built, wired and off by default, and on this station's own model it does not yet produce a
set.** Run live against `gpt-oss-radio` on the remote Ollama, the binding searches the library
correctly and then answers with an empty string. The degradation is exactly right — the floor filled
every request, all six of six every time, and an operator would have heard a normal hour — but the
model half is not earning its keep yet. What was learned, in order:

1. **`reasoningEffort: 'low'` was missing and is not optional.** At the default effort the first run
   searched eight times, spent 14,377 tokens over 85 seconds, finished on `length` and emitted
   nothing: the model used its entire visible allowance thinking. That is the identical failure
   already recorded on `MAX_OUTPUT_TOKENS` in `model.talk.break.writer.ts`, and it was not inherited
   because choosing records *looks* far more like a reasoning problem than writing a link does. It is
   not — the tool does the recall and filtering. With it set: 3 searches, 9 seconds, 5,695 tokens.
2. **Tool rounds are not free, because each one's results stay in the conversation.** The eighth
   search is reasoned about with seven searches' worth of library listing in front of it. `MAX_TOOL_STEPS`
   came down from 8 to 5; fewer, larger searches beat more, smaller ones on a host whose context
   spills VRAM.
3. **The last blocker was a plugin-level defect, and it is fixed.** With `reasoningEffort` fixed the
   conversation finished cleanly and `text` was STILL empty, while the same model wrote talk breaks
   perfectly. The only difference between those two callers is tools, and the cause was as suspected:
   on the turn where gpt-oss finally answers after a tool round it puts the answer in the **reasoning
   channel** and leaves the text content empty, so `stream.text` is `''`. `spokenAnswer` in
   `plugins/llm` recovers it, which fixes every future tool-using caller rather than only this one.

   Two guards on that recovery each cost their own live run to find, and both are the difference
   between a fix and a new bug. **A turn that asked for a tool is never recovered from**, because
   its reasoning is working-out rather than a reply and promoting it feeds the model its own
   thoughts back as the assistant's words. And **`tool-calls` disqualifies even with no calls
   attached**: asked for a final answer with no tools offered, gpt-oss still finishes that way when
   what it wanted was another search, and the reasoning then reads "Need more variety. Search for
   rock." Handing that back is worse than an empty string because it looks like an answer.

**With that in, the model programmes the order**: 13 records named from 5 searches, `finish: 'stop'`.
Two things found on the way there and worth keeping:

- **The prompt has to BOUND the searching.** "Search several times" with no ceiling had the model
  spend every round it was given searching and never answer, so the loop ran out and the forced
  final turn was still asking for another search. It now says three or four, then answer.
- **The library search matches genre, which was not obvious.** Asked to programme an hour the model
  searched `hard rock`, `metal band 80s` and `rock classic`; all three found nothing and it
  apologised that the library was empty when the library was full. It reaches for a style because
  that is how anyone thinks about programming radio — and because the tool RETURNS a genre on every
  row, which reads as an invitation to search one.

**Nothing about a failure here is silent.** The generator logs the searches, the tokens, the finish
reason and the first 400 characters of whatever it could not read; the chain logs how many of a
generator's picks the running order already held, which is the only visible symptom of a generator
naming records that are already scheduled.

`llm.setGenerator` is still off by default and was left off. Two things are worth knowing before
turning it on for real. Its answers are only as good as what the tool surfaces, and **genre matching
is one-directional** (§6): a search for `classic rock` does not match a record tagged `rock`, so a
model reaching for a compound style still finds nothing. And on this station the running order
currently holds more items than the library has playable tracks, which makes every generator — the
deterministic one included — come up short for reasons that have nothing to do with either of them.

The seam was already the right shape, so the call itself was smaller than it sounds. What was worth
building deliberately is everything around it, because each of these is a failure that is inaudible
until it has been running for a week.

**Artist variety is enforced at the point of choice, not inside the discovery tools.** A model given
tools that filter out the on-air artist returns a worse pool on a small catalogue, so leave the tools
open and re-pick when the answer repeats. The re-pick must exclude a **window** of neighbouring
slots (queued-and-unaired, on air, and recently played), not just the current track. An exclusion
that remembers only the on-air artist keeps returning to whoever ranks next highest, which is the
same artist every *other* slot rather than every slot. `spaceArtists` already models the window idea
deterministically; this is the same rule applied to a non-deterministic picker.

**The seed is not a pick.** Any prompt that hands the model the on-air track so it can seed a
similarity search has just put the one real, well-formed track id in its context that no tool
returned. Models echo it. Say so in the field description, once, in a shared constant, and do not
weaken it to "never invent an id", which an echoed seed literally satisfies.

**A zero-candidate run is a library-coverage fact, not a model failure.** If a circuit breaker
counts it, a thin catalogue disables the smart picker and advises changing models. Count a run with
no discovery calls at all, which genuinely is the model failing to drive its tools; do not count a
run that searched honestly and found nothing.

**Resolution is best-effort by design.** A model naming a song the catalog has never seen is the
case [director-and-lineups.md](director-and-lineups.md) scoped as live provider search. **That landed
2026-08-12**, so the rung now exists: `PickResolver` looks the record up across the searchable
provider plugins, ingests the exact match and airs it. A pick nothing carries is still dropped and
the count still comes up short, which `generate` documents as an ordinary outcome.

That change also settled the paragraph above about the discovery tool, and then unsettled the two
tools themselves. Both answered with records that could air, so the split stopped being schedulable
versus not and became what the station HAS versus what it can GET — a PREFERENCE the descriptions
carried and the model had to arbitrate. **That arbitration is now gone** (2026-08-20): `search_music`
answers from both and marks every row `owned`, because the preference was real and the decision was
one the host could make itself. See `docs/internals/programming.md` for what is load-bearing in it.
**The operator can now say what an hour should be**, which is the other half of this entry that was
never written down here because it did not exist: `station_lineup.brief`, free text, set when the
station goes on air and re-read on every refill, in the user turn of `setPrompt`. It is now the ONLY
thing that says what to play: `llm.setPersona` was retired into a persona's `music` line, and that
line has since been deleted too, because a second prose description of the music made a local model
split the difference between the two. A period (`era_from`/`era_to`) rides beside it as the one
structured half a brief can have — see `docs/internals/personas.md` and the period rule in
`docs/internals/director.md`. Measured on the station's own `gpt-oss-radio`: asked for "heavy metal
hits" it named 23 of 24 in four searches and 85 seconds, `finish: 'stop'`, and four of those were
records the library did not hold and Spotify did.

## 2. Budget and degradation tiers, built before the model, not after

**Deferred 2026-08-12, against this section's own ordering claim.** Entry 1 was built without it.
The reasoning is written down rather than the decision, because the day `baseUrl` points at
somebody's paid API this re-opens and the numbers change:

- **The ordering claim assumed a retrofit that no longer exists.** It was written 2026-08-09, before
  `LlmService` and `LlmGate`. There is now exactly ONE model call site (`ModelTalkBreakWriter`) plus
  the one entry 1 added, and every call already funnels through `LlmService.generate` /
  `generateWith` / `converse`. The retrofit surface is one file and stays one file by construction,
  so the "forty call sites" this was racing to get ahead of cannot arise.
- **The tokens are not billed.** ~~`plugins/llm` is an OpenAI-compatible client against a
  self-hosted `baseUrl`. A daily token cap caps nothing that costs money.~~ **This expired
  2026-09-04.** `plugins/llm` now reaches Anthropic and Gemini as well as an OpenAI-compatible
  server, all three at once, with the model name saying which — which is the day this section named
  in as many words: "the day `baseUrl` points at somebody's paid
  API this re-opens and the numbers change". A station on a hosted arm bills per token, and a refill
  that loops is money rather than a warm GPU. Note the shape a cap would now have to take: providers
  are chosen per WRITER, so "the station spent its allowance" is the wrong unit — a local model doing
  the reading costs nothing while the hosted one writing the breaks costs money, and a cap that
  counted both together would stop the free half. Nothing else here moved — the retrofit is still one
  file, and `LlmResult.usage` already carries the counts a cap would read — so what is deferred is
  the cap itself and not the reasoning for it. The other thing a cap would buy —
  contention — is already handled by `LlmGate` serializing to one generation at a time. *(Sharpened
  2026-08-16: serializing handles contention and says nothing about PRIORITY, which is a different
  thing and now has its own answer — `gate.priority.ts`, two tiers, the station ahead of anything an
  operator started. If a tier system is ever built here it should be read as a policy over that
  vocabulary rather than a new one: "soft" is background admissions being refused, which is gate
  state, not a module. The measurement to know before designing it: 17 of 24 `failed` rows in
  `script_history` were the model writer giving up in the gate queue, which no token cap would have
  changed.)*
- **The invariant this exists to protect turned out to be structural rather than policy.** "No tier
  makes music stop" holds because `BreakWriterRegistry` falls through to `TalkBreakWriter` and
  because `SetGeneratorChain` tops up from `CatalogSetGenerator`. Both are tested. A tier module
  does not make either truer, and building one would have implied the guarantee lived in it.

One piece was kept rather than deferred with the rest: `ModelSetGenerator` logs what each run cost —
tokens, wall time, searches made, picks named — for the reason `WriteAttempt` keeps a duration for
every writer and not only a slow one. "The model got slower" is a question that can only be asked of
numbers gathered before anybody suspected it. A log line, not a table.

### The number this section lacked, and the hole in the column it would be built over

**Measured 2026-08-28**, over the 237 rows in `script_history` between 2026-08-21 and 2026-08-26.

**What the station actually spends: 289,108 tokens over 5.3 days, about 54,400 a day**, of which
245,068 went on the 115 attempts that produced a script and 44,040 on declines. That is the figure
that makes this section arguable rather than theoretical, and on a self-hosted model it changes
nothing: the second bullet above still holds, and a cap still caps nothing that costs money.

**What it does change is that the column cannot be trusted to build a cap on.** Of 176 model
attempts, 13 provably occupied the model and recorded no usage at all: all 3 `failed` rows, and 10 of
the 36 declines reasoned "the model writer had nothing to say here" that nonetheless carry a non-zero
`duration_ms`. The other 26 of those declines are correct, having never made a call, and so are all 61
deterministic rows. Every decline that came from judging what the model WROTE records its usage
properly, so the meter is complete wherever an answer came back and blank wherever one did not.

The two worst cases are the two clearest: a plugin disposed with the response body still open (7,972
ms) and a writer that waited out its 60-second budget and gave up (60,007 ms). Both spent the model
and neither is visible to a counter over this column. **A timeout and a mid-flight disposal are the
two shapes a runaway takes, so a cap built on `usage` as it stands would be least accurate under
exactly the conditions that produce the bill it exists to stop.** Whatever eventually implements the
tiers has to record an attempt's cost at the call boundary rather than from the answer, and the
cheapest way to get that is `comparable-stations.md`'s trace correlation, which has to carry the same
fact for its own reasons.

**That is now built, 2026-08-28, and this is the surface a budget should be argued from rather than
`script_history.usage`.** `LlmService.generateOnce` opens a span and closes it in a `finally`, so a
generation that produced no answer still has a duration, a model and an outcome; usage is on it when
the model reported any and absent when it did not, which is the distinction this section needed and
the column cannot make. `apps/api/scripts/traces.ts --ops` is the aggregate. **`script_history.usage`
is not fixed and does not need to be**: it is a per-attempt record of what a WRITE cost, the spans
are the record of what the station spent, and a cap belongs on the second.

This also revises the note in the second bullet above. That measurement said 17 of 24 `failed` rows
were the writer giving up in the gate queue, which no token cap would have changed; on the current
window there are 3 `failed` rows and one of them is that shape. The conclusion is unchanged and the
denominator moved, which is the usual reason to re-state a number rather than to trust it.

### The same blindness on the SET side, and it has already moved a number

**Measured 2026-08-28**, over the 50 `set-*.json` captures in `.docvol/logs/captures`, 2026-08-19 to
2026-08-25. Twenty-nine of them produced no picks at all, which looks like a 58% failure rate and is
not one thing.

**It splits at `9bfab65`/`def027e`, 2026-08-20 14:29Z**, the two commits that gave the tool loop
`FINAL_TURN` and `NOT_AN_ANSWER`:

| | runs | produced nothing | shapes |
| --- | --- | --- | --- |
| Before those commits | 24 | 19 (79%) | `stop` 9, `tool-calls` 7, `length` 2, `other` 1 |
| After | 26 | 10 (38%) | `length` 10, and nothing else |

Neither `FINAL_TURN` nor `NOT_AN_ANSWER` appears in any of the 29 transcripts, which is how the split
was confirmed rather than assumed: before those commits the loop simply ran out of steps and returned
whatever text it was holding — one capture's whole answer is `Search for "Slayer".` after five
searches it never got to use. **Those two commits removed three of the four failure shapes
completely.** Anyone reading the 58% as a live figure is reading a fixed bug.

**What survives is one shape, and it is not the shape it reports.** `LlmService` returns
`finishReason: 'length'` from three places: a model that really hit its ceiling, a conversation
preempted mid-generation, and one preempted between steps. The last two set `preempted: true`
alongside it — and **`writeCapture` records `finish` and not `preempted`.** So the file whose own
comment calls it "where a zero-pick run is actually read" cannot tell "the model ran out of room"
from "the station took its own slot back", which are the two readings with opposite fixes.

**Both of the ten that can be attributed were preemptions.** The rotated logs reach only the last
two, and both sit 3ms after `llm: a conversation was preempted mid-generation`, preceded by
`llm: taking the model back, because something with a deadline wants it | from=background for=air`.
A break with a deadline took the model twice in nine seconds; the background refill lost everything
both times, and the second had already restarted after losing the first. The other eight are outside
the retained window and are not attributable at all.

**This has already moved a number, which is why it is here rather than in a log.**
`DEFAULT_MAX_OUTPUT_TOKENS` went 2,000 → 6,000 → 12,000, and the last raise is argued in its own
doc comment from "four consecutive briefed refills finished on `length` with zero tool calls and an
empty answer: the model used the whole allowance thinking and never emitted a word." Five of the ten
surviving failures have exactly that shape — `searches: 0`, empty answer, `length` — and on this
evidence they are indistinguishable from four preemptions, for which doubling the ceiling does
nothing. The reading may still be right. It was not checkable then and it is not checkable now.

**FIXED 2026-08-28, and not by adding the field.** Copying `preempted` into the capture would have
been one line and would have kept the thing that caused this: a reason that lies and a flag beside it
that corrects the lie, where every reader has to know to ask the second question and none of them
did. `LlmConversation.finishReason` is now `ConversationFinishReason = LlmFinishReason | 'preempted'`
— overridden on the host's own type, because `LlmFinishReason` is the plugin SDK's and describes what
a PROVIDER reported, and no plugin can ever return this. The boolean is deleted. Every one of the
eight `finish: result.finishReason` log sites and the capture became correct without being touched,
which is the test of whether the fix was at the right end.

Two things it also settled. `ModelSetGenerator`'s ceiling warning had to carry `&& !result.preempted`
by hand and no longer does, because `'length'` now means the ceiling and nothing else.
`ModelTalkBreakWriter` has the same `finishReason === 'length'` branch and never had that guard: it
is correct today only because `shouldPreempt` evicts nothing at `air` priority and a break holds
there, so the bug was latent rather than live. It is now correct by construction.

**What is still open** is the eight empty captures that fell outside the retained log window and can
never be attributed. The next window can be. Until one has been read: do not raise
`DEFAULT_MAX_OUTPUT_TOKENS` again on the strength of a `length` count, and do not read the 38% as a
model problem. The lesson stands whatever that reading says, and it is the `usage` column's above:
**record the cost and the cause at the call boundary, not from the answer.**

### Four things the trace surface leaves behind

Recorded rather than fixed, because each is a deliberate bound and the day one of them stops being
right there will be a number saying so.

- **The window is seven days and it is a constant, not a setting.** `MAX_TRACE_FILES` in
  `trace.spans.ts`. That is the right default and it is the wrong shape if this is ever the evidence
  in a slow-moving argument — which is exactly what §2's budget would be. It is also the bound that
  cost the measurement above eight of its ten cases, one layer down. **A setting here is cheap and
  should be added the first time somebody wants a fortnight**, not before.
- **`TracesService` reads the whole window and slices it.** No cursor, deliberately: `/activity`
  pages with a keyset because rows arrive at its head continuously, and this is a scan of files that
  cannot change, opened by somebody looking into something. The page says what that cost
  (`TracesPage.spans`, reading 1,119 on the first live run) rather than hiding it. **If that number
  gets uncomfortable the answer is a shorter window, not a cursor over a file.**
- **Every job now records a `job.run` span, and nothing reads it as a job metric yet.** It exists so
  a decision that called nothing still records its parent edge, and it happens to give every job a
  wall clock and an outcome — which nothing in this tree had before. "Which jobs fail, and how long
  do they take" is now a one-pass question over a file that is already being written, and no surface
  asks it. That is the cheapest unclaimed thing on this page.
- **A job that enqueues another is two decisions with an edge, not one decision.** That is honest and
  it means the reader's per-decision cost is wall-clock, not summed call time — so a parent whose
  child does the real work reads small with the cost indented beneath it. Correct, and it reads oddly
  until the indent is noticed.

**The station-wide voice switch this section wanted is already `rotation.breaks`**, which gates
before generation (the planner plants nothing, so no writer is ever asked). Do not add a second one.

What follows is the design as it stood, unbuilt.

**Lands at:** a settings-backed gate in front of every model call, and a `settings` layer that can
hold it (`deadair.settings` has only a repository today; the DB-backed layer is the prerequisite —
**this has since been built**, so that half of the prerequisite is gone).

Three tiers over a per-day token count, and the policy lives in one module, never inline at a call
site:

- **normal**: everything runs.
- **soft** (some percentage of the cap): fall back to `CatalogSetGenerator` and mute optional
  segments. The station still plays and still says its name.
- **hard** (at the cap): make **no** model call at all. Not a shorter one, not a cheaper one. The
  deterministic generator carries the station, which it can do indefinitely.

A station-wide voice switch belongs in the same module, and it must gate **before generation**, not
at the point of speaking: gating the renderer still pays a model to write every script and then
throws it away. Manual operator triggers stay exempt from both, the same way an explicit action
should always beat a cadence.

The invariant worth writing into the tests: **no tier makes music stop**. The floor is a
deterministic generator and a queue, and both work with every network dependency down.

### The resource that IS scarce here is the card, not the tokens

**Added 2026-08-21**, from building the second speech engine, and it belongs in this section because
it is the same shape as a budget and a different quantity. Nothing about a self-hosted model is
billed, which is most of why the tiers above are deferred — but the GPU it sits on is finite and the
station now has two things that want it. `plugins/chatterbox` can drop its model between breaks
(`unloadAfterRender`, off by default) and `plugins/llm` has no equivalent, so a station that turns the
speech side on is freeing memory for a language model that never gives any back.

Three things are worth recording so this is not re-derived:

- **Whether it is expressible at all is a question about the operator's server, not about us.** The
  OpenAI-compatible protocol has no unload, so this is not a `plugins/llm` feature in the way the
  speech one was a `plugins/chatterbox` feature: it depends on what the thing behind `baseUrl`
  exposes, and a plugin that speaks the generic protocol has nowhere to put an engine-specific call
  without becoming an engine-specific plugin.
- **The measurement carries over and is not encouraging.** An unload of the speech model reclaimed
  roughly 70% of what it held, because the graphics runtime keeps the rest until the process exits.
  Assume the same shape here: this buys back most of a model, not a card.
- **The cost is not symmetrical with the speech side.** A break is rendered ahead of its slot and can
  be skipped, so paying a load before one is a break that is late at worst. A refill holds the model
  for minutes and something is usually waiting on it, so an unload between refills is paid back at
  exactly the moment the station wants an answer.

Which is to say: worth doing only on a card that is measurably contended, and worth measuring before
designing. `LlmGate` and `SpeechGate` being two independent gates over one physical card is the
related idea, and a bigger one — see "one model slot" in `docs/internals/llm.md`, which argues against
widening a gate and says nothing yet about narrowing across two.

## 3. Ending-aware transitions

**Landed at**, 2026-08-11, and not where this line said it would: an `analysis` capability of its
own, a Python sidecar behind it, and `deadair.track_analysis` for the row. **Not an enrichment
plugin** — enrichment asks upstreams what they KNOW and merges the answers in priority order, and
there is nothing to merge when the number is computed from the samples and there is exactly one
source of it. See [track-analysis.md](track-analysis.md) and the capability's own header.

The four points below are measured and the two cheap ones are audible: `liq_cue_in` / `liq_cue_out`
ride the annotation, so the dead air is trimmed off the head and tail of every record. What has NOT
landed is the second half of this line, the `cross` in `radio.liq` whose length is per item rather
than constant — see [crossfades.md](crossfades.md), which is now unblocked.

Today a track ends and the next one starts. The reason that sounds like a playlist rather than a
station is not the absence of a crossfade, it is that a single fixed crossfade is wrong for most
pairs: a record that fades out wants to be ridden over for eight to twelve seconds, and one that
ends cold wants about four or the cut lands inside the last chord.

So the useful unit of work is not the fade, it is the **measurement**.

### Measure four points, not one classification

An earlier draft of this section said to classify the ending as fade-or-cold and map the two classes
onto a length. Do not build that. It is a classifier plus a lookup table, both of which have to be
tuned by ear, and it describes one track when the thing being decided is a pair.

Measure instead, per track, four points on one timeline:

| Point | What it is |
| --- | --- |
| `cue_in` | where audio actually starts, past the leading silence |
| `intro_end` | where the record is fully underway (the vocal or the beat), so the talk-up limit |
| `outro_start` | where the ending begins, so the earliest a blend may start |
| `cue_out` | where audio actually stops, before the trailing silence |

All four are absolute offsets from the start of the FILE, including `cue_out`. Storing it relative
to `cue_in` is the obvious-looking choice and it is wrong: everything downstream seeks in file time,
so a relative figure has to be re-based at every read and eventually is not.

Two lengths fall out: `intro = intro_end - cue_in`, `outro = cue_out - outro_start`. The blend for a
given pair is then

```
buffer = min(outgoing.outro, incoming.intro)
```

which has no tuned constant in it. A record that ends cold has a short outro and is barely ridden;
one that fades has a long one and is ridden for as long as the next record's intro can absorb, and
never longer, so a blend can never eat a cold opening. The pair logic that the earlier draft promised
would be small turns out to be this line.

Detection can be cruder than it sounds. `cue_in` and `cue_out` are the first and last crossings of a
level floor, about -60 dBFS, and that is the whole algorithm for two of the four points. `intro_end`
and `outro_start` are the real work, and the failure mode to design against is a detector that
weights low frequencies only: it places `outro_start` too early on a quiet ending, which is exactly
the case the whole feature exists to serve.

**`cue_in` and `cue_out` are separately shippable, and cheaper.** Trimming dead air off the head and
tail of every record is audible on its own, needs no pair logic, no `cross`, and none of the clock
work in [crossfades.md](crossfades.md), because it changes where an item starts and stops rather than
how two of them overlap. `liq_cue_in` and `liq_cue_out` are already annotate keys. If this section is
ever cut for time, cut it down to those two rather than dropping it.

### Four notes that save a pass

- **Nobody sells this, so do not go looking.** Checked 2026-08-10. Every catalog and audio-features
  upstream that still answers returns the same vector: tempo, key, energy, and their neighbours.
  None of them returns an ending. The one large free corpus of computed descriptors stopped taking
  submissions in 2022 and is a fixed dump, so it is a cold-start layer for back catalogue keyed by
  recording id and nothing for anything released since. The open toolkits that would compute these
  values are worth a look for the two hard points, with a licence check first, because the usual one
  in this space is AGPL and this would run inside the API process. **That check has since been
  done** in [the analysis licence rule](../../analysis/README.md#the-rule-stated-once), and it came out as a standing rule rather
  than a per-toolkit judgement: nothing copyleft or non-commercial enters the analysis path, weights
  included. It also does not run inside the API process, per the corrected bullet below.
- ~~**Analysis is an enrichment plugin, not app code.**~~ **Wrong, and corrected by building it.**
  The fan-out shape was the right instinct and the capability was not: enrichment merges what
  several upstreams claim about a recording, and a measurement has one source and nothing to merge.
  It is `analysis`, its own capability, and the plugin is an adapter over a sidecar rather than the
  thing that measures — which is what keeps a decoder out of the API process. Not a copyleft toolkit
  out of the host realm: there is no copyleft toolkit anywhere in the analysis path, by the decision
  linked above. The plugin never touches the bytes: the host resolves the audio URL
  because one plugin may not ask another for a stream.
- **A byte-capped or partial download cannot produce an outro.** Whatever fetches the audio has to
  say whether it got the whole file, or the analysis will confidently describe a truncation as a
  cold ending. A body is bounded separately from the fetch that returned it, by
  `PLUGIN_BODY_IDLE_TIMEOUT_MS`, `PLUGIN_BODY_LIFETIME_MS` and `PLUGIN_RESPONSE_MAX_BYTES`, and an
  audio file is exactly the case those bounds exist for. A truncation caused by one of them has to
  be told apart from a short track rather than measured.
- **Do not shorten the fade inside a fixed buffer.** If the buffer is a constant and the fades are
  shorter than it, the outgoing track plays at full level while the incoming one ramps and the two
  sum audibly. Vary the buffer, keep fade length equal to it. With the rule above the buffer is
  already per pair, so this is satisfied by construction rather than by care.

`intro_end` is worth measuring even if no crossfade is ever built: it is the talk-up limit, which is
what would let a talk-over cue itself against the record instead of being handed a time. Sharpened
2026-08-11 in [dj-voice.md](dj-voice.md): the limit a DJ actually respects is the first sustained
vocal, which is later than "fully underway" on most records and is worth measuring as its own field.

**Added 2026-08-11: this section is no longer the only consumer of the measurement**, and where the
numbers come from has moved to [track-analysis.md](track-analysis.md). The four points above stand
unchanged; what that file adds is the beat layer underneath them (tempo, a confidence to go with it,
a downbeat grid, a vocal curve) which the transition work in [crossfades.md](crossfades.md) needs and
these four do not provide, plus the two constraints that decide where analysis runs. The second of
those constraints is the licence note above, promoted: it bears on the architecture rather than only
on the code, because a sidecar speaking HTTP is a different position from linking the same toolkit
into the API process.

### Ordering the set so the transitions are easy

The cheapest transition is the one between two records that already fit. Once tempo and key are
measured, the running order itself becomes a place to spend that, and the algorithm is small:

Score each candidate boundary as a weighted cost, then walk it greedily, taking the lowest-cost next
track from what remains. Weights that work: tempo distance as a log ratio, weighted heaviest;
harmonic distance next, at roughly half, computed around the circle of fifths with relative
major/minor treated as near; and a small penalty for putting two vocal-heavy records together. The
greedy walk is not optimal and does not need to be, because the thing being avoided is the jarring
pair rather than the imperfect one.

**The part worth copying exactly is the handling of unmeasured tracks.** They break the sequence into
segments and keep their original positions, rather than being sorted on defaults. A single confident
number cannot be allowed to drag an unmeasured record across the hour, and a low-confidence
measurement has to score as "no opinion" rather than as a value near zero.

Two cautions specific to us. This is a rotation-ordering concern and therefore belongs behind
`SetGenerator` (§1) rather than in the pusher, since the director owns the running order and nothing
else may reorder it. And it competes with the rules already there: repeat windows and artist
cooldowns are correctness, harmonic flow is taste, and taste must not be allowed to win. Applying it
within the freedom the rules leave, rather than as a sort over the whole pool, is the version that
cannot break anything.

## 4. Per-track gain, alongside the live normalizer

**Lands at:** a resolved gain on the `annotate:` uri the pusher pushes, read by `radio.liq`.

`normalize(target=-16.)` on the leaf sources holds the station roughly level, but a live normalizer
is a follower: it pumps on dynamic material, it takes a moment on each new item, and it fights the
duck ramp because both are moving gain at once.

The static answer is per track and decided before air: prefer the file's own ReplayGain tags where a
source carries them, fall back to a measured figure, then **cap the boost and respect peak
headroom** so a quiet master is not lifted into clipping. Three details that matter more than they
look:

**Where the measured figure comes from** is [track-analysis.md](track-analysis.md), "Loudness", added
2026-08-11. Both numbers this section needs (integrated loudness and a true peak, without which the
headroom cap is a guess) fall out of the analysis sidecar's existing decode.

**Built 2026-08-11**, and the trap that section warned about was real. The sidecar now decodes at
48 kHz keeping up to two channels, and reports `integratedLufs`, `truePeakDb` and `samplePeakDb` in
the `data` blob. Measuring a mono downmix was tried first and was wrong twice over — 3 dB low on
uncorrelated material, no reading at all on anti-phase — so if anything here ever reads suspiciously
quiet, that is the first thing to check.

**The gain itself was built 2026-08-11**, on `playout/gain.ts`: `gainFor` resolves one number per
item, `annotate.ts` stamps it as `liq_amplify`, and `radio.liq` acts on it with an `amplify` between
`cue_cut` and `normalize`. The target is `playout.targetLufs`, read per hand-over so an operator
moving it is heard on the next record rather than the next running order. Two rules ended up carrying
the file, and neither was obvious when this section was written:

- **A cut is never capped by the peak and a boost always is.** Turning a record down cannot clip it,
  so the headroom check has no business in that direction, and a boost with no peak to check against
  is refused rather than guessed at.
- **The follower had to be demoted in the same pass, not left alone.** A fade is a level falling for
  tens of seconds, which a follower reads as a record needing a lift, so `normalize` was riding the
  gain up as records ended — audible on air before anything was built. It now holds below -25 dB,
  reacts over 30 seconds, and may add at most 6 dB. Left as it was, it would have spent every record
  undoing the static gain.

**The ReplayGain tag is preferred where a file carries one**, also 2026-08-11: the sidecar reads the
container's tags in the ffprobe it was already running and reports `tagGainDb` with the
`tagReferenceLufs` that gain is relative to, because a correction without the level it corrects to is
not a weaker claim but no claim at all — R128 fixes -23, ReplayGain is assumed to mean -18, and the
two are five decibels apart. `pick.resolver.ts` turns the pair back into a loudness and prefers it,
which is the ONLY place the preference is expressed. The tagged PEAK is never preferred: it is a
sample peak by definition and the sidecar measured a true one.

What is left of this section is gaining rendered audio by the same function. **That half is
deliberately still open** — nothing measures a segment, so segments still ride the follower, and the
level difference against a gained record is worth hearing before it is designed for.

- It is one number per item, so it rides the annotation the pusher already builds
  (`playout/annotate.ts`), and costs nothing at air time.
- Anything the station **renders** has to be gained by the same function, or produced audio sits at a
  different level than the records around it. That is the failure this prevents, and it is the one
  people notice.
- This matters most exactly when the station spans sources, because a local file, a Navidrome file
  and a Spotify decrypt do not agree about level and never will.

## 5. Never-play rules, beyond a dislike

**Lands at:** `rejectDisliked`'s neighbourhood in `rotation.rules.ts`, and the candidate SQL.

**Rescoped 2026-08-19 into [never-play-rules.md](never-play-rules.md), which supersedes this section
for the build.** What is below is still the design and the two rules under it are still the rules.
Three things it could not have known, all in that file: `PickResolver` is now the single chokepoint
every pick passes through, so "enforcement is inherited" is already paid for rather than something to
arrange; `RotationCandidate` is `{ songKey, artistKey, rating? }` and carries nothing a predicate
could read, which is the actual work; and the scope axes are four rather than two, since
`track-lyrics.md` needs a DAYPART ("nothing explicit before nine") and the daypart schedule brings a
slot. It also records two refusals this section leaves open: no `require` direction, and no weight
column, on the argument the bubble section below already makes.

A dislike is per entity. What a station also needs is a **predicate**: never play this genre, this
tag, this mood, anything on this playlist, anything by this artist, with two qualifiers.

- **A seasonal allow-window.** Inclusive month and day, wrapping the year end, in the station's zone.
  This is the same problem the setlist mode already reasons about from the other side: a Christmas
  record is not disliked, it is out of season eleven months a year, and putting it in a setlist
  solves airing it but not suppressing it.
- **An optional lineup scope**, so a rule can apply to rotation and not to a feature.

Two design rules, both learned the expensive way elsewhere:

- **Enforcement is inherited, never added.** Rules evaluate at the chokepoints a dislike already
  passes through. A second filter bolted onto a pick path is how the two kinds drift until one is
  enforced in three places and the other in two.
- **A rule is absolute, like a dislike.** No never-starve exception, including for a listener
  request. A rule that quietly relaxes under pressure is worse than no rule, because nobody can
  reproduce it.

Offer no one-click undo on a row that a *rule* excluded: one rule can cover hundreds of rows, and
the edit belongs where the rule is, not where a symptom of it showed up.

### The bubble, which the rules above cannot fix

**Added 2026-08-11.** The rules are all FILTERS, and a filter has nothing to say about the far side
of itself. `sampleCandidates` draws `order by random()` and the rules reject what is inside the
repeat window, inside the artist cooldown, or over the per-artist cap. So a record aired four days
ago and one that has never aired at all are drawn with identical probability, and on a library of
any size that is a structural cause of a station that sounds like it owns two hundred songs. Nobody
notices it as a bug, because every individual choice is legal.

The fix is a **bias, never a filter**, and the distinction is the whole of it: a filter that
preferred unaired tracks would starve a small library and would fight the rules for authority over
what may air. A soft rank term does neither. The shape that works:

- A freshness score ramping 0 to 1 over roughly a fortnight since last airing, weighted at something
  like 0.4 against a random base, so it *tilts* the draw and never decides it.
- Keyed on `normalizeKey` from `rotation.keys.ts` rather than on the track id, so two copies of the
  same recording share one history. That is already the rule `play_history` is written under, which
  is why this is a join rather than a schema change.
- Never aired at all sorts first, and is worth a marker on the candidate: it is a fact a writer can
  use ("first time on the station") and it costs nothing to carry.

**One trap worth writing down before anything is built.** Do not rank a source by the station's own
play counts. Anything ranked that way is a positive feedback loop — what aired is what is offered,
so what is offered is what airs — and it produces exactly the bubble this entry exists to break,
while looking like a popularity feature. If a "most played" source is ever wanted, its window has to
rotate or it will pin the same shelf forever.

## 6. Catalog correctness: genres and era

**Lands at:** `catalog.types.ts` and the candidate SQL. Two small pure functions, both of which the
catalog gets wrong silently by default.

**Genres are multi-value and matching is one-directional.** A tag may REFINE a request but never
broaden it: a lineup asking for "Punk" accepts a `Punk Rock` record; one asking for "Pop Punk"
rejects a plain `Pop` record. Containment must be word-boundary aligned or a "Rap" filter pulls
`Trap`. Store the array; a scalar first-genre column is fine as a generated, indexable convenience,
but it must never be the thing that is written.

**Era is judged by resolved original year, not by the year on the row.** An album's `year` is the
year of *that release*, so a compilation reports its own reissue date and every track on it lands in
the wrong decade. Prefer an original release date where the source gives one, treat a compilation's
plain year as **unknown** rather than as evidence, and enrich the gaps from MusicBrainz, which is
already a plugin here. Whatever precedence the SQL uses and whatever precedence the JS uses have to
be the same precedence, or a lineup filter and a lineup badge will disagree about the same track.

Both of these are cheap now and expensive after a catalogue has been built on the wrong answer.

## 7. Listener signal

**Lands at:** a new table plus a route beside `POST /playout/bridge/listener`, and a weight in
`rotation.rules.ts`.

Operator dislikes are decided by somebody who is logged in. A listener is not, and requiring an
account to press a heart means nobody presses it.

So the record is **accountless**: one per apparent listener per airing, keyed by an HMAC of the IP
under a persisted secret, with the raw IP never stored. Two consequences to accept up front rather
than discover: one household behind NAT is one listener, and the key is stable only as long as the
address is. Both are the right trade for not having a login.

Two rules that are not obvious and are worth deciding once:

- **An operator's own mark is a real record, not a separate concept**, distinguished by a marker so
  surfaces can tell them apart. But it is **exempt from ageing out** and **exempt from the trim**,
  because a listener signal decaying is a taste snapshot expiring, while an operator signal decaying
  is the station forgetting curation somebody set by hand.
- **A mark on the station is not a write to the provider.** The one defensible exception is an
  operator unmarking when no marks remain at all, which is a toggle rather than a purge.

Feeding this into rotation is a weight in the existing draw, not a new mechanism.

## 8. What the operator can see

**Lands at:** the console, over the existing `RotatingLogStore` and `PluginLog`.

The logging chassis is better than what is built on it. Two surfaces close that gap, and the second
one matters more than it sounds:

- ~~**An activity feed**~~ **Built 2026-08-13.** See below.
- ~~**A diagnosis of silence.**~~ **Built 2026-08-13.** See below.

The general rule: every gate that can silence the station should be able to say, in one line, that
it is the one currently doing so.

### The silence diagnosis, as built

`silence.diagnosis.ts` is an ORDERED chain of nine gates, pure over a `StationFacts` snapshot, and
`PlayoutService.getStatus` gathers that snapshot and carries the verdict on the reading the console
already polls. The console renders it twice on the `StaleConfigBadge`/`StaleConfigAlert` split: two
words in the transport strip, the full panel with everything RULED OUT on `/onair`. There is no
second route and no second poll.

Five things are load-bearing and are the reason to read the file before adding a gate:

- **The ordering is causal, not cosmetic.** A stalled reconcile loop ranks above `streamUp` and
  `driving` because both of those are set by calls that loop makes, so a loop that stopped leaves
  them frozen at whatever they last said. Nothing below a blocking gate can be trusted.
- **`waiting` is its own state, not a mild fault.** A station idling for want of a listener and one
  that cannot reach its stream are both silent, and only one is something to go and fix. This is the
  same argument the `ready` badge was added on, and a surface that called either `degraded` would
  undo it.
- **`configNotAdopted` is reported and NEVER the cause.** A station can air perfectly well to
  somebody who connected before the config was replaced, so naming it as the reason for a silence
  with a different reason is how a real warning stops being believed. It gets its own alert.
- **`notDriving` is the RESIDUE and does not stand on its own.** Dropping the lease is what the
  dead-man switch and the audience gate are FOR, so it is a fault only when nothing above accounts
  for it. Found by running it: an idle station reported "there is a programme, an audience and a
  reachable stream" directly under the gate saying there was no audience.
- **The pair the whole thing exists for.** `IcecastStatsClient.listeners()` answers `undefined` for
  "could not read" and `AudienceWatch` was throwing that away, so an Icecast whose stats endpoint
  went down was indistinguishable from an empty room — and in `audience` mode the gate then never
  reopens. `AudienceWatch.reading()` keeps `readAt` beside the count. The GATE is deliberately
  unchanged: an app that cannot see Icecast has no evidence anybody is there. What this bought is
  the station being able to say so.

**A heartbeat is not a health check**, and `modules/shared/heartbeat.ts` holds no opinion about
thresholds: a poll every five seconds and a nightly sweep are both healthy and no one number
describes them both. It answers how long it has been and the reader decides. `register` is what keeps
boot from being a special case. A failure stays beside the loop (`PlayoutPusher.lastFailure`), because
a loop that threw and came round again is still alive and folding the two together leaves a reader
unable to tell a loop that stopped from one failing every pass. Two of the five loops have adopted it
— the ones the diagnosis reads; the rest are one line each on the day something asks.

**Nothing is stored.** No table, no migration, one existing row read (`station_air`, for whether the
station was stood down, which is the only fact not in memory). Memory is the authority for what the
station is doing now, and a stored copy of a live gate is a second thing that can disagree with the
gate. What WOULD want storage is "why was the station silent at 3am", which no live reading can
answer — that is the activity feed's, and it is now written there on the EDGE, keyed the way
`StreamConfigWatch` keys its warnings so a two-second poll cannot fill the table.

**What it deliberately does not cover.** Degradation: records skipped after failed hand-overs,
segments that never reached `ready`, a provider benching bindings. A break that missed is not the
question this answers, and a gate list that mixed the two would stop being an answer to "why can I
hear nothing". `apps/api/scripts/silence.smoke.ts` drives the whole chain against the real Icecast
and Liquidsoap; `--blind` points the stats client at a closed port, which exercises `audienceUnknown`
without stopping a container and is therefore safe against a station that is on air.

### The activity feed, as built

`GET /activity`, `platform.view`, drawn at `/activity` in the console: one time-ordered list, filtered
by module and by a severity floor, paged by a keyset cursor.

Four decisions carry it, and three of them are the same decision looked at from different sides.

- **It is a UNION of three tables and owns one.** `station_events` is new and holds what happens to
  the station as a whole; `segment_events` and `play_history` are read where they already are.
  Copying either would give those facts a second writer, and a fact with two writers is two things
  that can disagree with no way to tell which one lied. `script_history` is deliberately not a fourth
  source: a break already appears through its segment rows, and one row per write ATTEMPT would
  report one break as four lines. It is the DETAIL behind a segment entry, which is the obvious next
  slice and is not built.
- **Producers write on edges, never on polls.** The console polls the transport twice a second. The
  same discipline that keeps `announceSilence` from filling the log is what keeps this from being a
  log file with a primary key, and it is why the designed sub-second gap every first listener
  produces is kept out of the feed entirely while a recovery long enough to have mattered is not.
- **`ActivityRecorder` never throws**, and every caller `void`s it. Nothing reads a row here to
  decide anything, so a lost row is a gap in a feed; a thrown one would be the station losing the
  silence, the air toggle or the recovery the event was describing.
- **The sentences live outside the SQL.** `station_events` rows arrive already phrased by whoever had
  to phrase them; the other two hold facts that were never written for a reader, and `activity.feed.ts`
  writes those. Composing them in the `union all` would put station copy inside a repository.

### What writes to it

Every producer is an edge that already existed and already had a log line; none of them is a new loop.
The transport's own (`silence.cause` on a cause change, `gap` on a recovery long enough to have
mattered), the director's (`air.on`/`air.off`, `set.generated`, `order.caughtUp`, `item.skipped`,
`break.claimStale`), the render path's (`break.degraded`), the catalog's (`binding.benched`,
`track.discovered`), and the two operator surfaces (`order.*`, `airMode.set`, `plugin.*`). Only the
last group stamps `station_events.actor_id`: everything else is the station acting on its own.

Three of them were decided against the alternative that looks obvious:

- **A catch-up is ONE event carrying a count.** `StationLineup.markAiring` answers how many items it
  passed over, because that number exists nowhere else — the states say what happened and nothing says
  how much of it there was. The first version of the feed covered only the narrow case, a break that
  was not ready when its slot came round, and a dropped stream then wrote off twenty committed items
  in silence. Twenty rows would have been the opposite mistake, and the same argument every producer
  here is written under.
- **A refill is reported by the chain, not the job.** `ExtendLineupJob` can see how many records
  arrived and never which binding found them, because a `TrackPick` does not carry its generator.
  `SetGeneratorChain` credits what was KEPT rather than what was named, says nothing when a single
  generator filled the batch alone, and speaks up for a SHORT batch even from one — a library that has
  run dry is invisible from the running order.
- **A break reaches the feed only when it fell through.** The registry answers with every attempt
  precisely so that a model declining and the floor covering are two facts, and `segments.writer`
  records who won and cannot say who was asked.

And one rule that is not about volume: **the feed carries the station's own sentences and never a
third party's text.** Nothing here is redacted, which is safe only while every `detail` is written by
app code from facts the app controls. An upstream error body, a provider's response or a plugin's
message must be summarized in the station's words, with the verbatim text left in the log — which is
also the line between this and `PluginLog`, below.

`apps/api/scripts/activity.smoke.ts` is what covers the union, for the reason `rating.smoke.ts` covers
`effectiveRating`: the interesting half is SQL. It walks the real feed a page at a time and checks the
three properties that make it a feed rather than three lists — descending order, no row twice, no row
skipped at a page boundary — and `--write` appends one station event and removes it again, which is
the only way to exercise the third source on an install that has not been silent yet.

**What it deliberately does not carry.** Plugin call logs, which §8 asked for above: those are
`PluginLog`, behind `GET /plugins/{id}/logs` on a `platform.manage` floor precisely because plugin
output is whatever a plugin chose to write and a careless one can put a token in a line. Folding
them into a `platform.view` feed would quietly undo that. Linking out to a plugin's own log viewer
from a feed entry is the right shape, and is not built.

## 9. The writer, and what it must not be allowed to do

**Lands at:** [dj-voice.md](dj-voice.md) piece two. Not restated here, with one addition that belongs
with the rest of the model work above.

A prompt that is asked to be concrete about music and is shown no track fields will reach into
training data and describe a record that is not playing. The failure is specific: it is not that the
model invents facts, it is that it frames real facts as a **cue** ("coming up", "you just heard",
"that was"). Ban the framing rather than the noun, because a feature about an album that cannot name
the album is not a feature. Ask separately for certainty, because inventing credits and mis-cueing a
real record are independent failures and a single instruction covering both gets neither.

## Smaller entries, noted so they are not re-derived

- ~~**`search_catalog` does not say which results the station already owns.**~~ **Done 2026-08-20**,
  as `search_music`. Worth recording what this entry got WRONG, because it deferred the work on the
  wrong axis: it judged the value by how much the two answers OVERLAP, and reasoned that a small
  library makes the flag pointless. What actually cost hours was not the overlap, it was the
  ARBITRATION — a model asked which store to search, on a library that overlapped the providers
  almost nowhere, spent every tool step it had asking the wrong one. The flag was the cheap half; the
  expensive half was deleting the choice.
- **The taste block has never been exercised against real data.** `TasteRepository`, the prompt block
  and `station_taste` are all built and tested, and on this install `deadair.tracks`, `albums` and
  `artists` hold zero non-zero ratings — so every list is empty, every total is 0, and the steering
  half of "cross-reference my likes and dislikes" is inert rather than wrong. The enforcement half
  (`rejectDisliked`) is unaffected and has its own tests. Before designing anything on top of the
  steering, rate a few dozen rows and look at what a real prompt block costs in tokens: `TASTE_SHOWN`
  is 15 per kind, chosen against nothing.
- **The Icecast burst is a BYTE count** (`burst-size`, currently 8192, so backlog is under a second
  and nothing downstream needs to care). If it is ever raised for faster player start, note that the
  same byte figure is a different number of seconds on every mount at a different bitrate, and that
  every listener then sits that far behind the live edge for the whole connection. Anything that
  displays a playhead to a listener has to shift by the advertised depth. Do not try to measure that
  offset in the browser from `buffered`: a player's buffered range reports what it has demuxed, not
  what the connect burst put in an internal cache, and the two differ by roughly the whole burst.
  `queue-size` should stay comfortably above `burst-size` or a client is evicted the moment it falls
  behind its own primed buffer.
- **Break kinds become a rule.** `BREAK_KIND` in `break.planner.ts` is the constant `'ident'`, with a
  comment saying so. Once a talk break can be written, which slot gets which kind is a decision, and
  it belongs beside `breakEveryMinutes` rather than in the planner.
- **Rotation rules as settings.** `DEFAULT_RULES` is a constant with good reasoning attached and no
  way for an operator to touch it. Already noted in
  [director-and-lineups.md](director-and-lineups.md); repeated here because entries 1, 2 and 5 all
  want somewhere to put a setting and none of them should be the one to invent it.
