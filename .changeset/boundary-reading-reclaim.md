---
'@deadair/api': patch
---

A reading taken at the instant an item leaves the player's queue to go on air no longer reclaims it as a lost push. The grace now runs from the last reading that counted the item rather than from its hand-over, so a break that had waited in the queue for minutes is not offered again (and rewritten) while it is airing.
