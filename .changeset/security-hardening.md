---
'@deadair/api': patch
---

`/nowplaying` and the cover a player draws off the stream now only ever name the station's own cached copy of a cover. A record committed to the player before its cover was cached used to report the provider's own URL, which for a Navidrome station carried the operator's username and token to anybody who asked. The cover now appears the moment the station has cached it, and until then players show the station's logo. A podcast episode's cover goes through the same cache.

The playout bridge and the three signed audio routes can no longer be reached by changing the case of the path or adding a trailing slash, which the router accepts and the gates in front of it did not. The bridge is also refused outright at the station's own web server, since nothing legitimate reaches it from outside.

The production image now reads the audio chain's settings file as the station's own user rather than as root, so a value in it can never run anything with more rights than the station already has.
