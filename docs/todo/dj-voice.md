# Deferred: the DJ that actually says something

**As of:** 2026-08-08, when the station first played audio it was not given by a music provider.
**Revised:** 2026-08-08, when piece one landed. The station now has a voice; what is left is
something to decide what it says.

The station can say things, and can now say them in its own voice. What it cannot do is decide what
to say: every word it speaks is one somebody handed it. This file was the two pieces between here
and a DJ. **Piece one is built** — see the note under it for what shipped and what came out
differently. Piece two is the whole of what is left.

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

Two things that are true and easy to assume otherwise: nothing measures a segment's duration
(`duration_ms` is null on every row), and **nobody has yet listened to the bed duck under a voice**.
The ducking path is `radio.liq`'s existing `ducked()` and the voice queue satisfies its readiness
check, but that is inference. Confirm it by ear before building on it.

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
- **The audio streams both ways.** `speak()` returns a handle, not bytes, and the host drains it
  through `PluginStreamSource`. That made `docs/decisions/plugin-streaming.md`'s byte protocol its
  first implementer, five days after it was specified and shelved. `ContentStore.writeStream`
  hashes as it writes, so a long break never exists whole in the process.
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
  has no artist. If the station ever needs to avoid repeating a talk break, that wants its own table
  rather than a relaxation of this one.
- **The harbor mount.** `input.harbor("dj", …)` was removed when the voice queue replaced it. Bring
  it back as a second arm of the voice source if something genuinely needs to stream live audio in;
  a real microphone is the honest case.

## Related

[director-and-lineups.md](director-and-lineups.md) for the rest of the director's deferred half, and
[from-v1.md](from-v1.md) for what the previous station did here, which is where both pieces above are
ported from rather than invented.
