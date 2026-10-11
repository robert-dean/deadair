---
'@deadair/api': patch
---

Timed lyrics already fetched from LRCLIB are looked up once more, in the background at the lyrics walk's usual pace, so records whose lyrics time each word gain those timings. The words already stored keep showing throughout, and a record LRCLIB no longer matches keeps the lyrics it had.
