---
'@deadair/desktop': patch
---

A connection that goes quiet is now noticed. When the stream stops arriving without the player reporting a failure, as can happen when wifi drops, the app used to go on saying Listening over silence. It now retries after 10 seconds without audio, unless playback is still moving, and a retry that hangs is retried in turn until the app says it cannot reach the station.
