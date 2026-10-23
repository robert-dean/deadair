---
'@deadair/android': patch
---

The Quick Settings tile reads "On" as soon as the shade is opened with the station already playing, rather than "Warming up" until the player next changed. The connection the tile binds on each open now takes the player's playing and buffering state from the moment it binds, not only whether play was asked for.
