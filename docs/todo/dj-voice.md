# Deferred: the DJ that actually says something

**As of:** 2026-08-08, when the station first played audio it was not given by a music provider.
**Revised:** 2026-08-08, when piece one landed. The station now has a voice; what is left is
something to decide what it says.
**Revised:** 2026-08-09, with the ordering question answered: see "What to build before piece two".
**Revised:** 2026-08-09, when the ducking was finally heard rather than inferred.
**Revised:** 2026-08-09, when the first two of those three landed and the goal was restated as a
station the operator listens to all day instead of a streaming service. That restatement reorders
what is left; see "The order, restated against daily listening".
**Revised:** 2026-08-12, when piece two landed in full. **Both pieces are now built.** Read "What
piece two actually shipped" below before anything else in this file: the sections under it are kept
for their reasoning and describe a tree that has moved on.

The station can say things, says them in its own voice, and now decides what to say. This file was
the two pieces between here and a DJ, and both are in. What remains of it is the list of smaller
things it always said it would leave behind, plus the talk-up limit, which is still blocked on the
beat layer.

## What piece two actually shipped

**2026-08-12.** Three writers rather than the two this file predicted, and four pieces of plumbing
underneath them that it did not predict at all.

**The seam is `BreakWriterRegistry`, keyed by `segments.kind`, holding SEVERAL writers per kind in
registration order** — which is preference order. A writer that declines, returns whitespace or
throws is one outcome to it: ask the next. So the fall-through lives in one place rather than inside
each writer, and a fifth kind of break gets it for free. It answers with every ATTEMPT rather than
only the winner, because a model that declined and a floor that covered for it are two facts.

**The floor stopped being code and became a setting.** `PHRASINGS` is now
`rotation.breakTemplates`, one phrasing per line, with the station's own five as the DEFAULT — so
clearing the box restores them rather than producing a silent DJ, and the way to stop the station
talking stays `rotation.breaks`. `{{next.title}}` resolves through an explicit map, `[[double
brackets]]` mark a part dropped when it cannot be filled, and `ConfigFieldType` gained `text` for the
box it is edited in. That is a station sounding like itself with no model anywhere near it, which
this file never considered and which is probably what most operators actually want.

**The model is the first binding, not the second.** `ModelTalkBreakWriter` sits in front of the
templates, off until `llm.breakWriter` is turned on, bounded tightly (ten seconds of queue,
forty-five of generation, no tools) because the write window means its slot is a quarter of an hour
away. Its prompt is shaped around §9 of
[station-intelligence.md](station-intelligence.md): ban the CUE framing rather than the noun, and ask
for certainty separately. Its answer is guarded rather than trusted — quotation marks, stage
directions, speaker labels and a reasoning model thinking out loud are all stripped, and an answer
past the word ceiling is declined rather than cut.

Four things came with it that this file did not ask for, each because the writer sat on plumbing that
was not there:

- **`deadair.script_history`**, one row per write attempt, outliving its segment and swept nightly.
  This is the "somewhere for what the station SAID to live" that correction 3 asked for, arriving
  earlier than expected and shaped as a record of what was WRITTEN rather than of what aired.
- **A state per stage**: `planned → writing → written → rendering → ready`. A retry after a failed
  render re-speaks the words already on the row rather than paying a writer for new ones.
- **A break is written when its slot comes near** rather than when it is planted. It used to be sent
  the instant a break was planted, which meant up to five breaks written and rendered at once, the
  furthest an hour of airtime ahead.
- **The forward claim is checked before airing**, which is correction 5 below, and was a live defect
  in the deterministic writer rather than anything the model introduced.

One bug was found by running it rather than by reading it, and is worth keeping here because the
shape of it will recur: the running order is written through a THROTTLE, so `WriteBreakJob` could
pick up a break the persisted row did not hold yet, find no neighbours, write a break that named
nothing, and — having consumed its claim — never revisit it. Every talk break reduced to saying the
station's name. The neighbours are now read BEFORE the claim, and absent-from-the-order means early
rather than has-no-neighbours.

## What exists, so nothing below has to re-derive it

Read this part before designing against it. All of it is built and verified on the running station.

- **`deadair.segments`** is one airable element that is not a record, with a `state` of
  `planned | rendering | ready | failed`. Every row today is born `ready` because it came from a
  file; the other three states exist for exactly the work below and nothing writes them yet.
- **A segment airs as an ordinary running-order item.** The director converts a `ready` one into a
  `RundownTrack` under `pluginId: 'deadair.render'`, and the rundown, the aired notify, the transport
  status and the mount label all work with no idea that anything changed. Verified: an ident aired
  with `remainingMs` counting 5008 → 268 and handed cleanly to the next record.
- **A segment that is not `ready` is SKIPPED, never waited for.** This is the rule everything here
  depends on: it is why a renderer that is slow, broken, or not yet written cannot cost the station
  silence. A skipped segment does not even cost the running order its lead — the commit pass
  coalesces the wake it fires and refills within the same pass.
- **The station plants its own breaks**, one ident every `breakEveryItems` records
  (`rotation.rules.ts`), from the refill job and from the reactor. It counts records rather than
  items, so a second kind of segment does not push the next ident back.
- **The DJ can talk OVER a record.** `radio.liq` holds a second `request.queue` and an armed cue; the
  app says what to say and against which item, and the script picks the instant. Intro cues only.
- **The segment audio route** is `GET /segments/{id}/audio`, anonymous, serving one declared mime.
  Liquidsoap HEADs it before it GETs and picks its decoder from that header.

One thing that is true and easy to assume otherwise: nothing measures a segment's duration
(`duration_ms` is null on every row).

**The ducking is confirmed by ear, 2026-08-09.** It was inference until then. A `talkbreak` segment
spoken by `plugins/kokoro` was planted with `overAtMs: 10000` through
`POST /director/lineups/{id}/segments`, and the bed ducked under the voice ten seconds into the
record it rides and came back up. Everything on that path works as designed: the segment never
became an item of the running order, the cue was armed as the record was handed over, and the
record aired with no starve and no fall-through to the local bed.

Two things that pass follow from it, and neither is fixed. **Whether a cue fired is invisible from
the app side.** `radio.liq` tracks `idle | armed | fired | missed` and says in its own comment that
`missed` is the one worth reading, but nothing surfaces it: it is absent from `/playout/status`, the
pusher never logs it, and `armVoice` is fire-and-forget with a swallowed `catch`. So a break that is
silently dropped looks exactly like a DJ that talks less than it should — see
[station-intelligence.md](station-intelligence.md) entry 8. And **the control bridge occasionally
answers 502**: one `POST /playout/skip` failed that way during the same session while the station
carried on airing normally. Both are worth a look before anything depends on a cue actually landing.

## Piece one: the station speaks in its own voice — BUILT

**Built 2026-08-08.** What follows is what was designed; the note at the end of this section says
what actually shipped, and it is the part to read before touching any of it.

`docker-compose.yml` already runs **Kokoro**, an OpenAI-compatible `/v1/audio/speech` server on
`:8880`, and its own comment says it is there "for the render pipeline". Nothing points at it. It is
the whole of the missing infrastructure.

The seam is the state column. A job takes a `planned` segment, moves it to `rendering`, POSTs the
script, writes the bytes through `SegmentStore` and moves it to `ready` — or to `failed` with the
reason. Shaped exactly like `ExtendLineupJob`: a plain `Job`, not a `TransactionalJob`, with
`overrideJobActor`, because it is slow work nobody is waiting on.

Settings follow `stream.settings.ts`, including its encrypted-secret handling: a base URL, a model, a
voice, and an API key that is empty for local Kokoro and set for OpenAI cloud. The same code reaches
both.

Two things worth knowing before starting:

- **A single-voice break needs no ffmpeg.** Kokoro returns mp3 directly. v1 needed ffmpeg for
  multi-voice shows and SFX mixing, which is a different feature. Do not port the pipeline wholesale.
- **The store holds one format on purpose**, and the reason is the Content-Type rather than the disk;
  see the note on `SEGMENT_EXTENSIONS`. mp3 is what Kokoro emits anyway, so this costs nothing here.

Once this lands, `BreakPlanner` should plant `planned` segments rather than choosing ready idents
from the library, and the skip rule stops being a backstop and starts being load-bearing.

### What shipped, and how it differs from the above

Read this rather than the design above it, which is kept for its reasoning.

- **It is a plugin capability, not a module-local renderer.** `speech` in the plugin SDK, with
  `plugins/kokoro` as the first implementer and Chatterbox expected next. So the settings are the
  PLUGIN's config (server URL, model, format, default voice, voice map), not `deadair.settings`
  keys following `stream.settings.ts`. The one station-level setting is `render.speechPluginId`,
  which picks the speaker when more than one plugin can talk; with several installed and none
  chosen it declines to guess rather than picking.
- **The audio streams.** `speak()` returns a `ReadableStream<Uint8Array>`, not bytes, and it is
  usually the engine's own `host.fetch` body forwarded straight through. `ContentStore.writeStream`
  hashes as it writes, so a long break never exists whole in the process. This first shipped as
  `docs/decisions/plugin-streaming.md`'s handle-and-base64-chunks protocol and was cut back to a
  plain stream once the subprocess option closed; see `docs/decisions/plugin-trust.md`.
- **A voice is an opaque station-level id.** The host passes `host` or `newsreader` and never
  interprets it; each plugin maps it in its own config. That is v1's engine-agnostic ref kept and
  v1's host-side per-provider matrix left behind.
- **The job is `RenderSegmentJob`**, shaped as predicted, plus a `voice` column on
  `deadair.segments` and a `POST /segments` route to plan one. `claimForRender` is a conditional
  update, so a retry arriving mid-synthesis cannot pay twice for the same audio.
- **`BreakPlanner` still chooses ready idents from the library.** Switching it to plant `planned`
  segments is deliberately the first commit of piece two rather than the last of piece one, because
  it is only worth doing once something can write a script.
- **Voice previews exist** at `GET /voices` and `GET /voices/{id}/sample`, cached in their own
  store under a key derived from the plugin, voice and sample line. A sample is emphatically not a
  segment: no row, its own root, and so unable to reach a running order.

## What to build before piece two

**Decided 2026-08-09**, against the tree as it stood that day. Two of these are prerequisites and
one is deliberately not; the point of writing it down is that the ordering does not need arguing
again.

**1. Finish the settings layer, which is half built. BUILT.** `apps/api/data/contracts/settings` and
`apps/web/src/routes/settings.tsx` both exist, so each new knob is one descriptor entry in
`settings.registry.ts` as intended. The rest of this item is kept for its reasoning.

`SettingsService.set` already reloads
`AppConfigStore` through `AfterCommit`, and `settings.registry.ts` declares what a station setting
is. What is missing is the other half: there is no `settings` contract under
`apps/api/data/contracts/` and no settings page under `apps/web/src/routes/`. This is a prerequisite
because piece two is almost entirely knobs — which `BreakWriter` binding, which model, the budget,
the degradation threshold, break tone and length — and without the page every one of them is a
`psql UPDATE` during the exact stretch of work where they get turned constantly. With the registry
finished, each new setting is one descriptor entry.

**2. Decide the LLM seam before `BreakWriter` binds to anything. BUILT**, and shipped as the shape
predicted at the end of this item: an `llm` capability in the plugin SDK, `modules/llm/` holding
`LlmGate`, the tool loop and `ToolRegistry` host-side, and an `llm.pluginId` setting mirroring
`render.speechPluginId` including its refusal to guess. `LlmService.canGenerate()` answers "no model
installed" without throwing, which is what lets a writer pick its deterministic binding rather than
fail. See the CLAUDE.md section on it for what stayed host-side and why. What follows is the
reasoning that produced it.

Today "LLM" exists only as
comments on `SetGenerator` and `pick.resolver`: no client, no module, no capability. The precedent
is one section up. Piece one was designed here as a module-local renderer POSTing to a Kokoro URL in
`deadair.settings`, and it shipped as a `speech` plugin capability with the engine's config in the
plugin. Every force that caused that applies harder to the model: the host is a remote Ollama today,
`todo.md` wants other providers and model choice, and it wants the choice made per feature. A writer
that talks to an Ollama client directly has its only dependency rewritten the first time a second
provider arrives.

So the shape is an `llm` capability in the plugin SDK, `LlmGate` as a host-side single-slot gate
carrying the two v1 fixes named under piece two (hold until the streaming body DRAINS, budget from
admission), and an `llm.pluginId` station setting mirroring `render.speechPluginId`. Then the
deterministic writer is binding one and the model is binding two, which is what piece two already
assumes.

**3. SSE is NOT a prerequisite, but its data is.** There is no SSE anywhere in the tree; the console
polls playout and air status on intervals (`playout.queries.ts`, `director.queries.ts`) and that is
adequate for what is on screen. Building the bus today means designing a transport for two events
that already poll fine.

Piece two is the first work where an operator genuinely cannot see what is happening: a model taking
forty seconds, a break degrading to the fallback writer, a segment going `planned → rendering →
failed`. So build the transport AFTER the deterministic writer, when the events are real. What to do
before then is make sure they are recorded FACTS rather than log lines — segment transitions
timestamped, a reason on `failed`, and a degraded write recorded as data. Then the feed is a
transport over rows that already exist instead of a redesign. This is the same want as `todo.md`'s
console/logs/activity feed.

**Deliberately skipped:** measuring segment duration. It is needed for outro cues (see "The smaller
things this leaves behind") but intro cues work without it and the skip rule covers the failure. It
follows a writer that exists rather than preceding one.

**The order, then:** settings contract and page → `llm` capability, gate and setting with no writer
yet → deterministic `BreakWriter` and `BreakPlanner` planting `planned` segments → the model as
writer two → the activity feed over the transitions those two produced.

The first two are built and the ducking has been confirmed by ear, so what remains of that order is
its last three. The section below reorders them.

## The order, restated against daily listening

**Written 2026-08-09.** The goal was restated: the near-term target is a station the operator leaves
on all day in place of a streaming service. That is a different test from "the station has a DJ", and
it moves one item onto this list that was never on it and reprioritises another.

**What is already good enough, so it does not need revisiting.** Selection is not the gap.
`rotation.rules.ts` gives a repeat window, an artist cooldown, a per-batch artist cap, artist
spacing so no act follows itself, and dislikes as an instruction a setlist cannot switch off;
`CatalogSetGenerator` weights liked tracks 2:1 without collapsing onto the same handful, and the
lineup auto-extends. Nothing on the list below is about which records play.

Three things stand between that and a working day of listening:

**1. It does not talk.** Every break is a pre-recorded ident chosen from the library
(`BreakPlanner.plant` reads `listReady('ident')`), so a station whose library holds none plants
nothing and is a shuffle. The deterministic writer is the whole difference between a playlist and a
station, and it needs no model: a back-announce is the two neighbouring lineup items, both already in
hand. This stays first.

**2. Records butt up against each other.** [crossfades.md](crossfades.md) calls this the largest
single audio-quality gap the station has, and over eight hours it is the one heard every three
minutes. It was never on the ordering above because that ordering was about the DJ rather than about
listening. It goes second, and it stays second rather than first because it changes
`on_air_elapsed`, which is the measurement every break is timed against and currently the part of
the system with no error in it. It wants breaks landing reliably before it moves the clock they
depend on.

**3. A failure is invisible.** A missed voice cue is not surfaced anywhere (see the note under "What
exists"), so a break that is silently dropped and a DJ that talks less are the same observation. Over
a day of listening that is the difference between knowing it is broken and wondering.

**The order, then:** deterministic writer and `BreakPlanner` planting `planned` segments → listen to
it for a week, because that surfaces real defects better than more planning does → crossfades → the
model as writer two → the activity feed.

Cue visibility rides along with the writer rather than being its own pass: the writer is the first
thing whose output can be silently dropped, and it is a `missed` state `radio.liq` already tracks.

The model moving behind crossfades is deliberate and is not a demotion. A slow remote host degrading
to a correct back-announce is the entire design, and whether that path works cannot be judged until
the floor exists and has been heard.

### The deterministic writer is BUILT

**Built 2026-08-09.** Four things differ from what is described above, and the last one changes the
order.

- **The seam is `BreakWriter` + `BreakWriterRegistry`, keyed by `segments.kind`**, exactly as
  correction 1 asked. `TalkBreakWriter` is the one binding. It picks from a handful of phrasings and
  recognises a past one by the words it opens with, which needs nothing written down anywhere. Titles
  are read rather than filed: a remaster year spoken aloud every fourth record was the most audible
  tell available.
- **A written break is planted EMPTY.** `BreakPlanner` puts down a `planned` row and its place in the
  order synchronously, and `WriteBreakJob` fills in the words behind it. That split is what preserves
  the planner's idempotency, since the segment is in the order before the next commit pass walks it.
  The job re-reads the running order rather than trusting a payload, because an operator can move a
  line between planting and writing.
- **Written breaks alternate with recorded idents**, carried on from the kind of the last segment
  already in the order. Preferring talk breaks made the DJ the only voice on the station and retired
  every ident the operator had dropped in.
- **Cue visibility did NOT ride along, because breaks are planted between records rather than over
  them.** `LineupSegmentItem.over` is untouched and still only reached by hand. The `missed` state
  stays invisible and stays worth fixing, and it becomes load-bearing the moment a break talks over
  an intro — which wants an `atMs` nothing can currently supply, since nothing knows where a record's
  vocal starts. What DID land is the reason for a break that never happened, on the lineup row where
  an operator is already looking.

Transitions are recorded as facts, per correction 4: `deadair.segment_events`, plus a `writer` column
saying what decided the words. The activity feed is now a transport over rows that exist.

**What was left, in order:** listen for a week → [crossfades](crossfades.md) → the model as writer
two → the activity feed. **The first three are done as of 2026-08-12**, so what is left of that line
is the activity feed. And separately, [listening-loop.md](listening-loop.md), which is what makes any
of it audible away from the desk.

## Piece two: something decides what to say

**Deterministic first, and not as a stepping stone.** A back-announce and an intro can be built from
the two neighbouring lineup items — titles and artists are right there — with no model at all. That
gives correct, instant copy, and it is the fallback the model half needs anyway. Build it as the
`BreakWriter` seam with one binding.

Then an LLM as a second binding, chosen by a setting, with the deterministic writer kept underneath.
That is not belt and braces: the LLM host here is a remote Ollama, and a context window that spills
its VRAM drops it to a couple of tokens a second, which stubs everything downstream. A slow model
must degrade to a correct back-announce, never to silence.

Port `LlmGate` from v1 with the two things it paid for in production:

1. The gate holds the single model slot until a streaming body **drains**. Releasing when `fetch()`
   resolves lets two generations overlap under `stream: true`.
2. The budget starts at **admission**, after `acquire()`, not at enqueue. Before that, queue wait
   counted against the budget, a long run's own calls starved each other, and every beat aborted into
   its stub.

`SetGenerator.generate` takes and returns _named_ picks — title and artist strings — which is what a
model can produce, so an LLM choosing the music is a second binding rather than a reshape. That is a
separate piece of work from the one above and should not be bundled with it.

### Four things the seam has to get right

**Added 2026-08-09**, while scoping the `llm` capability. The first of these changes the shape
described above, so read it as a correction rather than a footnote.

**1. The seam is keyed by KIND, not a single `BreakWriter`.** A registry over `segments.kind`, where
each writer takes a request carrying the moment the station is in rather than two tracks. The
previous station did not have one generator, it had five (a talk break, a sign-on, a news bulletin, a
DJ set, a two-voice dialogue) and every one of them read the same substrate and produced a script. A
seam shaped as `(previous track, next track) -> line` fits exactly the first of those and has to be
reshaped for the other four. `BREAK_KIND = 'ident'` in
[break.planner.ts](../../apps/api/src/modules/director/break.planner.ts) already carries a comment
saying it becomes a rule once something can write and speak a break; those kinds are what it becomes.

**2. The deterministic writer is the floor, not a phase.** Every generator in the previous station
fell back to a deterministic stub on any model failure, and that is what kept a rotation clock from
stalling on a slow model. It is not scaffolding to be removed once the model half works.

**3. What the station SAID needs somewhere to live, sooner than "The smaller things this leaves
behind" assumes.** The moment a persona or a mood is involved, an avoid-list becomes load-bearing: a
character sheet saying "use a signature phrase, but not in every script" is an instruction no writer
can follow without seeing the last few scripts. Still its own table rather than a relaxation of
`play_history`, for the reason given below.

**4. Record the transitions as facts while writing them, not afterwards.** A segment moving
`planned -> rendering -> ready | failed` wants a timestamp, a reason on `failed`, and a degraded write
(the model declined, the stub answered) recorded as data rather than as a log line. Doing it here
costs nothing; doing it later is a migration plus a backfill nobody can do. It is what turns the
activity feed above into a transport over existing rows.

**5. A break's forward claim is a FORECAST, and nothing currently checks it came true. BUILT
2026-08-12**, as both halves described below: the claim is withheld at write time when the next
record is not the adjacent line, and `segments.claims_item_id` is compared against what is actually
next at hand-over. What follows is the reasoning, kept because the same stamp is what every other
time-bound claim will be checked by. Added
2026-08-11, and it applies to the deterministic writer that is already built rather than only to the
model. `talk.break.writer.ts` says "Coming up next, X, from Y" — a statement about the future,
written when the break is planned, spoken minutes later out of audio that was rendered in between.
Everything that can happen to a running order in that gap makes it false: an operator drops or moves
the item, a request is inserted, a resolver drops the pick, the item is skipped for having no ready
audio. The station then names a record that is not the one playing, in a confident voice, which
sounds worse than saying nothing at all and is the kind of error a listener remembers.

The guard cannot be "re-resolve nearer to air", because the claim is baked into WORDS and rendered
audio cannot be re-cut. So it is two cheap checks at the two ends:

- **Withhold the claim when the forecast cannot be trusted at write time** — the writer already has
  a phrasing with no `next` in it and picks it when the next track is unknown, so this is choosing
  that phrasing rather than inventing anything.
- **Drop the line at hand-over when the order has drifted**, by stamping the item id the break named
  and comparing it against what is actually next when the segment is handed over. Silence on one
  boundary beats a wrong fact, which is the same trade the station already makes by skipping a
  segment that is not `ready`.

The same reasoning covers anything else time-bound a writer might say — the hour, "in the next half
hour", the weather — none of which is stateable until this stamp exists.

See [station-moment.md](station-moment.md) for the request those writers take, and
[tool-plugins.md](tool-plugins.md) for what a writer can ask mid-sentence.

## The talk-up limit, which is a measurement rather than a setting

**Added 2026-08-11.** A DJ talks over the front of a record and stops when the singing starts. The
station cannot do that, and the reason is not the audio path (the duck and the voice cue both
already work) but that nothing knows how long the intro is. Every break today is timed against a
number the planner chose, and over a record with a four-second intro that number is wrong in a way a
listener hears immediately.

[station-intelligence.md](station-intelligence.md) §3 already calls `intro_end` "the talk-up limit"
and measures it as where the record is fully underway. The sharper version, and the one worth asking
for while the measurement is being built anyway, is **the first sustained vocal**. A per-instant
vocal-presence signal falls out of source separation cheaply, and the first sustained crossing of it
after `cue_in` is exactly the instant a DJ stops talking. It is a different number from "the beat has
arrived", it is later on most records, and the gap between the two is free talk-up time the station
would otherwise leave on the table.

Three things this unlocks, in the order they are worth building:

- **A cue that arms itself against the record** instead of being handed a time, which is the thing
  §3 says `intro_end` is worth measuring for even if no crossfade is ever built.
- **A hard limit the writer must respect**, which changes the writing job rather than only the
  timing: a talk-up that has to land in 4.2 seconds is a length constraint on the text, and it is
  cheaper to constrain the request than to trim rendered speech.
- **The same trick on the outro**, where a break over a long fade is the other half of what makes a
  station sound like a station rather than a playlist with announcements.

The measurement itself is [track-analysis.md](track-analysis.md), including the fact that an
unanalysed track has to keep working: no vocal onset means no talk-up, falling back to the current
behaviour rather than to a guess.

## The smaller things this leaves behind

- **Outro cues.** "Finish two seconds before the record ends" needs the segment's duration, and
  nothing measures one. Liquidsoap can (`request.duration` on the resolved request), which is the
  better answer than trusting a tag or a header.
- **A console for segments.** There is no page for the library and no button for adding one to a
  lineup; the lineup table draws a segment row with its state and that is all. The routes exist,
  including `POST /segments`. There IS now a `/voices` page, but it previews voices rather than
  managing segments.
- **Play history for what the station SAID.** Segments are deliberately excluded from
  `deadair.play_history`, because the repeat window and artist cooldown are reads of it and an ident
  has no artist. **Half of this arrived on 2026-08-12** and it is worth being precise about which
  half: `deadair.script_history` records what was WRITTEN, not what aired, so it answers "what has
  the station been saying" and cannot answer "what did it say at nine o'clock". An aired-at stamp is
  still its own decision, and it still wants its own table rather than a relaxation of this one.
- **Which writer wins is registration order, not a setting.** `director.module.ts` ranks them and
  `llm.breakWriter` is the only switch. That is right for one model and one floor; an operator who
  wants the templates ABOVE the model on some shows wants a setting, and the registry would take one
  without changing shape.
- **A break still cannot be re-written.** A `failed` segment is not re-claimable for writing, on the
  grounds that the usual reason nothing could be written is that there was nothing true to say. An
  operator who edits their phrasings and wants last night's failures retried has no button for it.
- **The harbor mount.** `input.harbor("dj", …)` was removed when the voice queue replaced it. Bring
  it back as a second arm of the voice source if something genuinely needs to stream live audio in;
  a real microphone is the honest case.

## Related

[director-and-lineups.md](director-and-lineups.md) for the rest of the director's deferred half, and
[from-v1.md](from-v1.md) for what the previous station did here, which is where both pieces above are
ported from rather than invented.
