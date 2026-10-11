---
'@deadair/api': patch
---

A show whose brief names artists now gives part of every hour to the artists it has played least recently, without waiting on the model. It takes a top track from each, one per artist, so the artists at the end of a long brief get played even when the model runs out of time near the top. The share is a new setting, "How much of each batch comes from the artists a brief names" (0.4 by default; 0 turns it off). It needs a similarity plugin that can list an artist's top tracks, such as Last.fm or Deezer.
