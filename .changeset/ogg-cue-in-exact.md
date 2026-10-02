---
'@deadair/api': patch
---

Records no longer lose the first moment of their audio. Most records arrive as Ogg files, and the audio chain was starting them a little past the point the station measured as where the music begins, sometimes by more than a second. They now start where they should.
