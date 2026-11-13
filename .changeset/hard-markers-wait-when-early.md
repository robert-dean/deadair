---
'@deadair/api': minor
---

A hard marker now waits for its time when the music runs early, rather than airing ahead of it: it is planted at the boundary before its time with a bed in front of it (a recording of the `bed` kind), which plays until the time and is faded out there. It waits at most `rotation.hardMarkerMaxWaitSeconds` (a minute by default), only with a bed half a minute longer than the wait, and where it could either wait or cut the record in its way it takes whichever moves the music less.
