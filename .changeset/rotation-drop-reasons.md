---
'@deadair/api': patch
---

When the rotation rules throw away most of what a refill chose, the station's log now says which rule did it: how many records the repeat window refused, how many the artist cooldown held, how many were held because their artist was already queued, how many the per-artist and per-album caps cut, and how many were disliked. A show whose running order keeps running dry can now be traced to the rule that is spending it.
