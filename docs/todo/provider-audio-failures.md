# When the provider will not hand over audio

**Written:** 2026-08-11, after a live crossfade verification was blocked by it and turned up the
measurements below on the way.
**State of the tree, 2026-08-11:** the shim is healthy and individual tracks are not. Playout skips
what it cannot fetch, which is correct, and the audible result is dead air. 13 of 581 catalog tracks
are measured because the measurement pass hits the same wall.

> **Update, 2026-08-14: the silence measured below is no longer reachable by this path.** A record is
> not committed to the running order until its audio is on this machine
> (`docs/decisions/bytes-before-air.md`), so a provider refusing a track is discovered while the
> records ahead of it are still playing rather than at the boundary. The upstream problem is
> unchanged and everything under "Where to look first" still stands — what changed is that its cost
> is a thinner rotation instead of a gap on the mount.

This is not a crossfade problem, an analyzer problem or a rundown problem, though it stops all three
from being finished. Everything downstream is behaving exactly as designed; the audio simply does not
arrive.

## What was measured

**The shim's session is up.** `GET :3679/health` answers `{"ok":true,"session":true,"storedLogin":true}`
with no `loginError`. So this is NOT the refused-login path that `stream/spotify-shim/README.md`
tells you to read first, and that whole branch can be skipped.

**Individual track fetches return 502.** The recorded failure is
`unfetchable: HTTP 502 from the audio url`, and earlier rows in the same table carry
`Server returned 5XX Server Error reply` from ffmpeg against
`http://liquidsoap:3679/track/{spotifyId}?t=…`. Same shim, same credential, per track rather than
per session.

**It is most of the catalog.** 581 tracks, 71 measurement attempts, 13 trusted. 17 failures in one
30-minute window while this was being looked at.

**Playout hits it too, and that is the part with a sound.** A running order was hand-built from eight
measured tracks to exercise blending. Four of them — `Lycanthropy`, `As Above So Below`,
`In the Minds of Evil`, `Scourge of Iron` — went to `skipped`: handed to the player three times each
and never taken, which is `MAX_HAND_OVERS` doing its job. Captured off the mount, the result was
**2.16 seconds of digital silence** at one boundary and **1.02 seconds** at another.

## Why the silence, so it is not chased separately

The station stops driving when it runs out of playable items, and a mount deadair is not driving is
silent by design (`stream/README.md`, the lease). `nowplaying` reported `onAir: false` across the gap,
which is the app being honest rather than a fault. The local music bed underneath `playout_bed` is
empty on this install (`stream/music/` holds only `.gitkeep`), so there is nothing for the fallback
to drop to either.

So the silence is three correct behaviours stacked on one upstream failure. **Do not fix the
silence.** If the fetch problem turns out to be unfixable rather than a bug, the question worth
asking instead is whether a starve should reach for something — and that is a decision about the
bed, not about the transport.

## Where to look first

`stream/spotify-shim/README.md`, "What to look for", already names the weakest path and it fits the
shape of this: **relinking**. The shim takes the first alternative that has audio files rather than
checking the market the way `player.getUnrestrictedTrack` does. A 502 on some tracks and not others,
with a healthy session, is what a bad or missing alternative looks like from the outside.

Three things to establish before designing anything, in this order:

1. **Is it the same tracks every time, or scattered?** The failures carry `track_id`, and
   `deadair.track_analysis.failed_at` plus `failure_reason` is a complete record. A stable set points
   at relinking or availability; a scattered set points at rate limiting or the audio key path.
2. **Does the shim 502 for a track the station played last week?** Bindings are in
   `deadair.track_sources`; `deadair.play_history` says what aired. A track that played and now 502s
   rules out "this binding never had audio".
3. **What does the shim log at the moment of a 502?** The failure text the app records is ffmpeg's
   view from the far side of the HTTP boundary and names nothing useful. The shim's own reason is one
   layer down and is not currently surfaced anywhere the app can see, which is itself worth fixing:
   a 502 body carrying the shim's reason would have made this an afternoon rather than a day.

## What it blocks

- **The live half of `crossfades.md`.** The transition is verified against rendered audio and the app
  is verified to stamp both ends of a boundary from real measurements, but no blend between two real
  records has been observed, because the records will not fetch. See that file's state line.
- **The catalog being measured at all.** At 13 of 581, no consumer of the measurement — trims, per
  record gain, blends — is doing anything for 98% of the library.
- **`analysis-queue-ordering.md`**, which is about which tracks the walk picks. Worth reading
  alongside this: it already separates "an unfetchable binding" from "an undecodable file", and that
  split is exactly what the diagnosis above needs.

## What is NOT worth doing about it

**Do not raise the analysis batch size to catch up.** The pace is one track a minute against a
provider that is currently refusing, so a bigger batch buys more failures at the same rate and
suppresses each failed track for a day (`ANALYSIS_RETRY_AFTER_MS`). Worse, analysis and playout share
one credential and one upstream, and `job.mappings.ts` argues at length that playout wins. Running a
raised-limit analysis pass while testing playout is a mistake this file exists partly to record: it
was done here, and the tracks the test depended on were being downloaded in the background at the
same moment the player was failing to fetch them.
