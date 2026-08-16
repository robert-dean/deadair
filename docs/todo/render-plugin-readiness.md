# Deferred: a render that lost the race with plugin startup is failed as if it were wrong

**As of:** 2026-08-15, found in the log while working out why no `welcome` break ever rendered. It
is not that bug (that one is fixed: `da5c47d`, `2167fec`) and it was sitting beside it.

## The receipt

```
15:06:34.793 INFO  Setting up Render
15:06:35.059 INFO  render: nothing to speak with (no active plugin can speak; install and enable a TTS plugin)
15:06:35.069 WARN  render: could not speak a segment | segment=3612b794 error=render: no active plugin can speak; install and enable a TTS plugin
15:06:35.122 INFO  Ready Render
```

Between the second and third lines a `render.segment` job asked `SpeechService.speak`, got nothing,
and put `render: no active plugin can speak; install and enable a TTS plugin` on the row as a
permanent failure. Fourteen other segments rendered through the same kokoro install in the same
half hour. The engine was fine; the job simply ran before it was there.

## Why it happens, and why it is allowed to

`JobsModule` starts its workers in `ready` rather than `start`, and its comment already anticipates
this exact window:

> Ready hooks still run in registration order, and this module precedes `PluginsModule`, so plugins
> are discovered but not yet INITIALIZED here. A job that calls into a plugin has to tolerate a
> non-active one regardless (a plugin can be disabled, quarantined or reinitializing at any moment),
> so that residual gap is the same case, not a new one.

That is right about the CLAIM and wrong about the COST, which is the whole of this file. Tolerating
a non-active plugin means not crashing. It does not mean writing the row off. The position is also
fixed and should stay fixed: it is set by shutdown, which runs in the same order, so workers must
stop consuming before `PluginsModule` disposes the instances under them.

An operator hits the same window far more often than a boot does. Every plugin config change
reinitializes the plugin (`PluginLifecycleManager.reinitPlugin`), and there is a moment inside every
one of those where nothing can speak.

## What it actually costs, which is asymmetric

`RenderSegmentJob` catches everything and calls `markFailed(..., 'rendering')` rather than
rethrowing, on the stated argument that letting it bubble would spend the job's one retry on a
plugin that is usually still down. Sound for a plugin that is genuinely down, and exactly backwards
for one that is three hundred milliseconds from being up.

What happens next depends on something the render path cannot see:

- **A planted break recovers.** It is in the running order, so `BreakPlanner.ripen` sees it and
  `retryRenders` re-sends `render.segment` for any `failed` segment that still has its script. The
  cost is one of `MAX_RENDER_ATTEMPTS` (3), counted off `segment_events` rows, permanently spent on
  a failure that said nothing about the segment.
- **A break waiting for its audio does not.** An `interrupt` or `next` request has no position by
  design, `ripen` walks the order, and so nothing ever asks for its audio again.
  `DirectorService.injectReady` sees `state === 'failed'` and moves the request to `failed`. The
  moment does not come round again — a welcome is lost outright because the operator saved a plugin
  setting at the wrong second.

That second half is the same structural gap the write side had until `2167fec`, in the other job.

## The shape of the fix

Three pieces, and the first two are worth having on their own.

1. **Do not write off a segment for a failure that is about the HOST.** `SpeechService` already
   throws `PluginError` with code `unavailable` for exactly this case, so the render job can tell it
   from a plugin that spoke and produced nothing usable. Leave the row `written` — its script is
   intact and that is the state `claimForRender` starts from — instead of `failed`. Then the
   existing `releaseStranded`/`retryRenders` path picks it up with no attempt spent, and a station
   whose speech plugin is really uninstalled still shows the honest reason on the next pass, because
   the row is `written` with nothing rendering it rather than silently ready.

2. **Give a waiting request the retry the running order gives everything else.** `injectReady`
   already loads each waiting request's segment every pass; re-send `render.segment` for one that is
   `written`, and for a retryable `failed` on `retryRenders`' own bound. That is the render-side
   twin of the re-offer added in `2167fec`, in the same loop, and it is the only thing that will
   ever ask.

3. **Optionally, stop dequeuing speech work before there is speech.** The clean version is a
   readiness gate the render job consults rather than a reordering of `modules.ts`, since the module
   order is pinned by shutdown. *(Updated 2026-08-16: that gate now has a home. `SpeechGate`
   serializes the engine and is the singleton every speech caller already passes through, so the
   readiness question can be asked there instead of at a new seam. It also answers the objection
   below on its own terms — the gate sits beside `SpeechService.speaker()`, so "nothing can speak"
   is a fact it can read rather than guess, and the safe behaviour is to ADMIT and let the honest
   `unavailable` through rather than to refuse. Still piece 3, still last.)* Weakest of the three,
   and listed last on purpose: 1 and 2 make the
   race survivable, which is worth more than making it rarer, and a gate that is wrong fails closed
   on a station that has no TTS plugin at all.

## Where it lands

- `apps/api/src/modules/render/render.segment.job.ts` — the `catch` at the bottom of `execute`
- `apps/api/src/modules/render/speech.service.ts` — `speak` already throws `unavailable`; nothing to
  add, only to read
- `apps/api/src/modules/director/director.service.ts` — `injectReady`, beside the `planned` re-offer
- `apps/api/src/modules/director/break.planner.ts` — `retryRenders` and `MAX_RENDER_ATTEMPTS`, for
  the bound piece 2 should share rather than reinvent

## How to reproduce it

Put a break in the running order, and save any plugin's config (or `POST /plugins/:id/reload` on the
speech plugin) in the second before its render job runs. On a station with the model writer on, the
window is easy to hit by hand because the words take ten seconds and the render follows immediately.
