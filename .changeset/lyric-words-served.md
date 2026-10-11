---
'@deadair/api': patch
'@deadair/sdk': patch
---

The lyrics routes now serve a timed line's words when its source timed them. `LyricLineDetail` gains an optional `words`, each piece with the time it starts being sung and its text, the pieces joining back to the line exactly, so a player can light the word being sung. Lines from sources that only time whole lines are unchanged.
