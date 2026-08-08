# Deferred: what the rundown does not do yet

**As of:** 2026-08-05, when playback was first verified on air (Spotify playlist → Icecast).

Playback is built and working: playlist → `Rundown` → signed track-shim URL → Liquidsoap
`request.queue` → mount, with Liquidsoap's `on_track` posting back which item actually started. The
list below is what was consciously left out of that pass. **Do not assume any of it exists.**

## No persistence

Restarting the API loses the running order; the player keeps airing what it holds. v1 persisted it
because break timing had to name what was on air across a restart, so this lands with breaks and not
before.

## No playhead corroboration

No parking, recall TTL, playhead corroboration or self-retirement timer. Here `remainingMs` is only
displayed, so a jumpy reading is cosmetic.

**If anything ever schedules against the playhead, read v1's `rundown.ts` first.** Its two-reading
anchoring rule was paid for with a track that got retired a few hundred ms after starting.

## No breaks and no DJ voice

`radio.liq`'s harbor input and duck are wired and working, but nothing pushes to them: there is no
render pipeline in this repo. Depends on segments, see
[director-and-lineups.md](director-and-lineups.md).

## No mount metadata

Icecast reports `title: (none)`, so the stream itself carries no now-playing.

## Related

The one distinction the whole design rests on, and which any of the above has to respect: handing an
item to the player is not the same as it airing. Liquidsoap resolves and downloads the next request
while the previous one still plays, so treating "just handed over" as "now playing" puts the app a
full item ahead of the listener. Items move `queue → served → airing`, and only the player performs
the last step.
