---
'@deadair/api': patch
---

Idents and other recordings dropped into the segment inbox or uploaded in the console are now measured for loudness when they are imported, and ones imported earlier are measured on the next library scan. Until now they never were, so the station levelled them as though they were raw synthesised speech and turned them up by about 11.5 dB, which made a professionally mastered ident far louder than the records either side of it. A station with no analyzer still takes every recording as before.
