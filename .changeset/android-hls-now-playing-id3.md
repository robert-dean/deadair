---
"@deadair/android": patch
---

On HLS the record on screen now changes when the new record is heard, not several seconds before. The app reads the titles the station stamps into each HLS segment, as it already did with the MP3 stream's. When a change on HLS never shows up in those titles (the same record twice, or two breaks in a row), the screen still moves on its own, about 20 seconds after the player's buffer runs out. The MP3 stream is unchanged.
