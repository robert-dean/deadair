---
'@deadair/api': patch
---

The HLS playlist lists fifteen segments by default (thirty seconds) instead of six, and never fewer than ten. A player starts three segments back from live however long the playlist is, so a short playlist made no one closer to live: it only left a player with nowhere to go after a brief stall, and Android listeners lost their place in the stream. A station set below ten is raised to ten, and the setting's help now says what the number actually does.
