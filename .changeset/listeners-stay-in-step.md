---
'@deadair/api': patch
---

Listeners no longer fall further behind the console with every crossfade. The station's level follower let the
crossfade read ahead of real time at each blended boundary, so over a day the audio on every mount and on HLS
drifted minutes behind the titles, covers and timings the console shows, until Liquidsoap restarted. The follower
now does the same job without that, and the gap stays at the crossfade's own few seconds.
