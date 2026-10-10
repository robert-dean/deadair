---
'@deadair/api': patch
---

`/nowplaying` and the cover a player draws off the stream now only ever name the station's own cached copy of a cover. A record committed to the player before its cover was cached used to report the provider's own URL, which for a Navidrome station carried the operator's username and token to anybody who asked. The cover now appears the moment the station has cached it, and until then players show the station's logo. A podcast episode's cover goes through the same cache.
