---
'@deadair/api': patch
---

A scheduled block now starts on time even when its playlist can't be read. If the music provider times out, is switched off, or the playlist has been deleted, the station starts the block anyway and chooses records itself from the block's brief, period and host. The activity feed says so. Previously the station refused the change and kept playing the previous block, sometimes through several blocks after it. A playlist that was read but has nothing the station can play is still refused as before, and whatever is on carries on.
