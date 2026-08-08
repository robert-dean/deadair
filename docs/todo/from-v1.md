# Things v1 did that this tree will eventually want back

**Written:** 2026-08-08, from the memory notes accumulated while v1 was built.
**Source:** `/Users/robert/Projects/deadair_v1`, the pre-re-scaffold station. It is a finished,
working station; this repo was re-scaffolded down to a chassis and is rebuilding a subset of it.

Everything below **worked there** and does not exist here. This file is a map of what is worth
porting, not a plan: the module paths, settings keys and route names in v1 mostly do not survive the
re-scaffold (no `director`, no `engine.config`, no Navidrome, `music` is now `catalog`, and there is
a plugin architecture now that v1 never had). **Port the reasoning and the comments, verify every
path against the current tree**, and expect the shape to change where a capability becomes a plugin.

For work designed against *this* tree and then deferred, see the other files in this directory.

---

## The render pipeline

`apps/api/src/modules/render/` in v1: TTS rendering, ffmpeg, the harbor pusher that gets rendered
audio onto the mount, a take cache, per-episode transcripts, and `llm.gate.ts`.

This is the single biggest absent subsystem, and several deferred items here depend on it.

**Partly closed since this was written.** deadair now has a segment that airs, a station that plants
its own, and a voice that can be cued over a record with the bed ducked under it — so the harbor
pusher does not need porting at all: `radio.liq` fetches its own voice over HTTP from a second
`request.queue`, and no audio passes through the app. What is still absent is TTS and the take cache,
which is to say anything that produces the audio in the first place. See [dj-voice.md](dj-voice.md).

Non-obvious things v1 learned that are worth keeping:

- **`LlmGate` holds the single model slot until a streaming body drains.** Releasing on `fetch()`
  resolve lets two generations overlap under `stream: true`.
- **The LLM budget starts at admission, not at enqueue.** `LlmGate.fetch(..., budgetMs)` composes the
  timeout *after* `acquire()`. Before that, queue wait counted against the budget, so a long run's own
  calls starved each other and every beat aborted into its stub.
- **The duck ramp**: `smooth_add` was tried and abandoned. `stream/` in this repo came across from v1
  verbatim, so that part is already here.

## Breaks: the DJ that talks

`packages/core/src/breaks/` in v1: sign-ons, talk breaks, DJ sets, news bulletins, a rotation policy
and a set of deterministic quality checks on generated dialogue. Fed by `packages/core/src/feeds/`
(RSS news, Open-Meteo weather).

The seam this tree would hang it on is already described in
[director-and-lineups.md](director-and-lineups.md) under "Segments in a lineup" and "A DJ that
talks". v1 did break timing against a persisted rundown, which is why persistence appears in
[rundown.md](rundown.md) as a prerequisite rather than a nice-to-have.

## Shows and episodes

`packages/core/src/fountain/` and `podcast/`, plus `render/shows.*` and `episodes.*`. Multi-voice
talk shows written as a real back-and-forth discussion rather than read-aloud headlines. What v1
ended up with, after several passes:

- **Multi-pass screenwriting**: outline → draft with foresight → deterministic check and one
  re-draft → per-beat polish. `writingMode` per show (`quick` | `outlined` | `polished`).
- **Timing never comes from the model.** Beat count and word budgets are computed deterministically;
  the outline only supplies content, and coverage is repaired so a re-order cannot drop a story.
- **Beat count comes from the budget, not the item count.** One story in a 10-minute show used to
  mean a single beat asked to carry ~1300 spoken words, which is unwritable. Beats are sized to a
  150–260 word band and items spread across them.
- **Show styles** as presets (conspiracy, talkshow, debate, news-desk, cozy) with mode/tone/rules/cues
  and per-show overrides, mirrored in the console form.
- **Callers**, cast per episode, each assigned a voice from a pool.
- **`[SFX: …]` cue markers**, non-spoken, from an allow-list, with a `renderSfx` seam left for real
  mixing.
- **Human-in-the-loop preview**: a draft episode with an approve/regenerate step, and an in-flight
  preview that shows the script as it is written.
- **Resumable generation** via `generation-checkpoints.repository.ts` and `generation-control.ts`.
  Two gotchas paid for live: cancel must be terminal (or the job broker resurrects a cancelled run
  minutes later), and "no control entry" has to count as *still current*, or a cancelled run thinks
  it was superseded and skips deleting its own partial script.

## LLM plumbing

`packages/core/src/llm/chat.ts` and `json.ts`: one shared `chatComplete` that streams when asked and
otherwise does the blocking call, tolerant JSON parsing for model output, multiple providers and
models selectable per generator, and an opt-in per-provider `reasoning_effort` (sign-ons and talk
breaks pinned low, because thinking is wasted on them and costs wall-clock).

Worth knowing before designing against a local model: the LLM host is remote Ollama, and a context
window that spills VRAM drops it to a couple of tokens a second, which stubs everything downstream.

## The monitoring feed

v1 has a realtime pub/sub bus streamed to the console over SSE, with a JSON polling fallback:
progress, status, errors and logs from the render pipeline, jobs, the director, health probes and the
LLM gate.

**This one is cheap to bring back.** The generic core was lifted out into
`@maroonedsoftware/serverfeed`, which this repo *already declares as a dependency* and does not use.
v1 keeps only thin adapters: `apps/api/src/modules/monitor/` (a `provideMonitor` /
`getMonitor` pair mirroring `provideAppConfigStore`, because the feed is constructed in
`setup.server.ts` before the container exists so boot-time logs already reach the bus), the SSE and
JSON routers, and a logger bridge.

Three fixes that came with it, and that any SSE endpoint here will need:

- **Exclude the stream route from the audit-context middleware**, so a long-lived stream never pins a
  DB transaction.
- **Force-close lingering sockets on SIGINT/SIGTERM** (`closeIdleConnections()` +
  `closeAllConnections()` after start). Otherwise `server.close()` waits forever on an open SSE
  connection, the old process never exits, it keeps the port, and the restart looks like a hung boot.
- **Take over the raw socket** (`ctx.respond = false`) so a client disconnect does not make Koa log
  `ERR_STREAM_PREMATURE_CLOSE` as a spurious error event in the feed.

SSE auth is fetch()-based, keeping the Bearer header, because `EventSource` cannot send one.

## More music sources

v1 had Navidrome/Subsonic working end to end alongside Spotify, with live switching between them at
runtime and no restart: one always-built Liquidsoap `fallback([...])` where the active bed is
whichever the app feeds, a mode endpoint the go-librespot launcher polls so it only runs in Spotify
mode, and a director that rebinds its source dependencies mid-run.

In this tree a second source is a **plugin** implementing the catalog/playout capabilities, so the
DI-token half of that design is superseded. What ports is the Liquidsoap side and the switching
behaviour. One gotcha to keep: DJ-mode picks do not exist in a demo Navidrome library; use a real
Subsonic playlist id when testing.

## Now-playing sinks

`apps/api/src/modules/nowplaying/` in v1: a reactor fanning out to sinks, an Icecast metadata writer,
and a TuneIn AIR publisher (config-gated no-op unless partner credentials are set).

Two of these are already accounted for here: mount metadata is listed in [rundown.md](rundown.md),
and push destinations in [director-and-lineups.md](director-and-lineups.md) (as a plugin capability
fed by a `station.aired` event, rather than v1's hard-wired sink list). TuneIn's phase 0 is manual
and out of band: expose Icecast publicly, register the station, obtain AIR credentials.

## Selection intelligence

v1's `director/playHistory.repository.ts` and `enrichment/musicGraph.service.ts`: durable play
history driving a repeat window and artist cooldown, per-artist caps, and a palette derived from what
actually aired rather than from the pool. Artist similarity comes from Last.fm
(`artist.getSimilar` / `artist.getTopTracks`); MusicBrainz has no artist-similarity endpoint.

The rotation-rules and palette-steering entries in
[director-and-lineups.md](director-and-lineups.md) are the current-tree version of this.

## Station state

`packages/core/src/station/`: a reducer over station events with coalescing and staleness rules,
plus `modules/station/station.log.repository.ts` for the activity log behind the console.

---

## Things v1 wanted and never built either

From v1's own `todo.md` and the deferred notes around it. These have no implementation to port, so
they are ideas rather than ports:

- **Caller and persona memory.** Persist generated callers (name, town, voice, topics) so they recur
  across episodes, and more broadly let personas accumulate history and relationships. The outline
  step already casts callers per episode, which is where remembered ones would feed in. This is a
  table, not env config.
- **Full foley.** Turn the `[SFX: …]` markers into mixed audio through an asset library and ffmpeg,
  then duck it under speech.
- **Instant breaking-news breaks.** Superseded in design by the plugin `programme` capability and
  `Rundown.insertNext` in [director-and-lineups.md](director-and-lineups.md).
- **A schedule builder.** Superseded by the daypart schedule entry in the same file.
- **Generated ads and sponsors.**
- **Traffic breaks.**
- **A request bot** (Telegram was the sketch). Note the `station:request` permission in
  [director-and-lineups.md](director-and-lineups.md) is the piece that would gate this.
- **Track feedback**: like/dislike on artist, song, album, maybe genre; and a way to view saved track
  metadata.
- **Genius as an enrichment source**, alongside the MusicBrainz/Last.fm/Discogs set.
- **Home Assistant integration**, and a daily snapshot from a calendar.
- **More music sources still**: Pandora was plausible; YouTube Music and Apple Music looked hard to
  impossible.
