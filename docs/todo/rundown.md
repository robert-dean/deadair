# Deferred: what the rundown does not do yet

**As of:** 2026-08-05, when playback was first verified on air (Spotify playlist → Icecast).
**Revised:** 2026-08-08, when segments and the talk-over cue landed. Two of the four things this
file listed have been built since; what is left is below.

Playback is built and working: playlist → `Rundown` → signed track-shim URL → Liquidsoap
`request.queue` → mount, with Liquidsoap's `on_track` posting back which item actually started. The
list below is what was consciously left out of that pass. **Do not assume any of it exists.**

## No persistence

Restarting the API loses the running order; the player keeps airing what it holds, and the reactor
rebuilds a lead from the lineup cursor within seconds.

This file used to say persistence "lands with breaks and not before", because v1 could not time a
break without naming what was on air across a restart. Breaks have since landed without it, and the
reason is worth keeping: **the timing here is positional rather than scheduled.** A segment sits
between two lines of a lineup, and a talk-over cue is expressed against a running-order item and
evaluated inside `radio.liq`. Neither needs to survive a restart, because neither is a time.

So this is now deferred on its own merits rather than as a prerequisite for anything. What would
actually want it is something that must know what aired across a restart — a resume that is exact to
the second, or an as-run log the operator can trust.

## No playhead corroboration

No parking, recall TTL, playhead corroboration or self-retirement timer. Here `remainingMs` is only
displayed, so a jumpy reading is cosmetic.

**If anything ever schedules against the playhead IN THE APP, read v1's `rundown.ts` first.** Its
two-reading anchoring rule was paid for with a track that got retired a few hundred ms after
starting.

Something does schedule against the playhead now, and it is worth understanding why it is not a
counter-example. A talk-over cue fires a set number of milliseconds into a record — but the elapsed
time is counted in `radio.liq`, reset inside the `synchronous=true` `on_track` hook, in the loop that
produces the audio. Nothing about it crosses a process boundary. That is the whole reason it is
accurate, and the reason v1's warning still stands for anything that tries the same thing from this
side: the app's reading is a couple of seconds stale, the decoder leads the listener by the encoder
and client buffers, and neither error is recoverable from here.

## Breaks exist; the voice that would fill them does not

**Built since this file was written.** A lineup line can be a segment, the director commits a `ready`
one as an ordinary running-order item and skips anything else, the station plants its own idents, and
`radio.liq` can duck the bed under a segment cued against a record. The harbor mount is gone; the
voice comes off a second `request.queue`.

What is still missing is anything that WRITES or SPEAKS a break: every segment the station plays is a
file somebody recorded and dropped into an inbox. See [dj-voice.md](dj-voice.md), which is the whole
of the remaining work and the seams it drops into.

## Related

The one distinction the whole design rests on, and which any of the above has to respect: handing an
item to the player is not the same as it airing. Liquidsoap resolves and downloads the next request
while the previous one still plays, so treating "just handed over" as "now playing" puts the app a
full item ahead of the listener. Items move `queue → served → airing`, and only the player performs
the last step.
